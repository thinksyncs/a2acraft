//! macOS keeps one writable desktop process per application data directory.
//! A second process writes a byte to the locked file to reveal the owner.
//! The kernel releases the lock on exit, including after a crash.
use std::{
    fs::{File, OpenOptions},
    io,
    os::{
        fd::{AsRawFd, FromRawFd, OwnedFd},
        unix::fs::{FileExt, MetadataExt, OpenOptionsExt},
    },
    path::Path,
    ptr,
};

pub struct InstanceLock {
    file: std::sync::Mutex<Option<File>>,
}

impl InstanceLock {
    // Tauri can start the replacement process before its AppHandle is dropped.
    pub fn release(&self) {
        drop(self.file.lock().unwrap_or_else(|e| e.into_inner()).take());
    }
}

pub struct ActivationQueue(OwnedFd);

impl ActivationQueue {
    fn for_file(file: &File) -> io::Result<Self> {
        // kqueue returns a new descriptor; OwnedFd closes it on every error path.
        let fd = unsafe { libc::kqueue() };
        if fd == -1 {
            return Err(io::Error::last_os_error());
        }
        let queue = Self(unsafe { OwnedFd::from_raw_fd(fd) });
        if unsafe { libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC) } == -1 {
            return Err(io::Error::last_os_error());
        }
        let interest = libc::kevent {
            ident: file.as_raw_fd() as usize,
            filter: libc::EVFILT_VNODE,
            flags: libc::EV_ADD | libc::EV_CLEAR,
            fflags: libc::NOTE_WRITE,
            data: 0,
            udata: ptr::null_mut(),
        };
        let result = unsafe { libc::kevent(fd, &interest, 1, ptr::null_mut(), 0, ptr::null()) };
        if result == -1 {
            return Err(io::Error::last_os_error());
        }
        Ok(queue)
    }

    fn next(&self, timeout: Option<&libc::timespec>) -> io::Result<bool> {
        let mut event = std::mem::MaybeUninit::uninit();
        loop {
            let count = unsafe {
                libc::kevent(
                    self.0.as_raw_fd(),
                    ptr::null(),
                    0,
                    event.as_mut_ptr(),
                    1,
                    timeout.map_or(ptr::null(), |t| t),
                )
            };
            match count {
                0 => return Ok(false),
                -1 => {
                    let err = io::Error::last_os_error();
                    if err.kind() != io::ErrorKind::Interrupted {
                        return Err(err);
                    }
                }
                // kevent initialized exactly one event.
                _ => return Ok(unsafe { event.assume_init() }.fflags & libc::NOTE_WRITE != 0),
            }
        }
    }

    pub fn listen(self, reveal: impl Fn() + Send + 'static) {
        std::thread::spawn(move || {
            while let Ok(true) = self.next(None) {
                reveal();
            }
        });
    }
}

pub fn claim(
    dir: &Path,
) -> Result<Option<(InstanceLock, ActivationQueue)>, Box<dyn std::error::Error>> {
    let path = dir.join(".a2acraft-instance");
    crate::policy::permitted_location(&path)?;
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)?;
    let meta = file.metadata()?;
    if !meta.is_file() || meta.nlink() != 1 {
        return Err("Invalid application instance file".into());
    }

    // Subscribe before taking the lock so concurrent opens cannot miss a wakeup.
    let queue = ActivationQueue::for_file(&file)?;
    if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } == -1 {
        let err = io::Error::last_os_error();
        if err.kind() != io::ErrorKind::WouldBlock {
            return Err(err.into());
        }
        file.write_all_at(&[1], 0)?;
        return Ok(None);
    }
    Ok(Some((
        InstanceLock {
            file: std::sync::Mutex::new(Some(file)),
        },
        queue,
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relaunch_wakes_owner_and_lock_recovers_after_exit() {
        let base = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("a2acraft-instance-{}", getrandom::u64().unwrap()));
        std::fs::create_dir(&base).unwrap();
        let other = base.join("demo");
        std::fs::create_dir(&other).unwrap();
        let (lock, queue) = claim(&base).unwrap().expect("first launch");
        let (_demo_lock, _demo_queue) = claim(&other).unwrap().expect("separate profile");
        assert!(claim(&base).unwrap().is_none());
        assert!(queue
            .next(Some(&libc::timespec {
                tv_sec: 3,
                tv_nsec: 0
            }))
            .unwrap());
        // The old AppHandle still owns its managed state during a Tauri restart.
        lock.release();
        let (replacement, next_queue) = claim(&base).unwrap().expect("replacement launch");
        lock.release();
        drop((queue, lock));
        assert!(
            claim(&base).unwrap().is_none(),
            "replacement still owns the profile"
        );
        drop((next_queue, replacement));
        assert!(
            claim(&base).unwrap().is_some(),
            "kernel releases a dropped owner"
        );
        std::fs::remove_dir_all(base).unwrap();
    }
}
