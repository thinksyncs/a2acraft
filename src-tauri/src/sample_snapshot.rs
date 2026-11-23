//! Captures just the caller's WKWebView for the explicit fictional demo recorder.
use block2::{DynBlock, RcBlock};
use serde_json::Value;
use std::{ffi::c_void, sync::mpsc, time::Duration};
use tauri::WebviewWindow;

pub(crate) struct Frame {
    pub jpeg: Vec<u8>,
    pub map_signature: String,
    pub eye_signature: String,
    pub chat_signature: Option<String>,
}

type Completion = DynBlock<dyn Fn(*const u8, usize, *const u8, i32)>;

extern "C" {
    fn a2acraft_snapshot(
        webview: *mut c_void,
        regions: *const f64,
        count: usize,
        callback: &Completion,
    );
}

fn rect(value: &Value) -> Result<[f64; 4], String> {
    let mut out = [0.0; 4];
    for (index, name) in ["x", "y", "width", "height"].iter().enumerate() {
        out[index] = value[*name]
            .as_f64()
            .filter(|v| v.is_finite() && *v >= 0.0)
            .ok_or_else(|| "Invalid sample rectangle".to_owned())?;
    }
    if out[2] < 1.0 || out[3] < 1.0 {
        return Err("Empty sample rectangle".into());
    }
    Ok(out)
}

// Stage coordinates in CSS pixels may differ from the backing image on Retina displays.
fn regions(sample: &Value) -> Result<(Vec<f64>, bool), String> {
    let [x, y, width, height] = rect(&sample["bounds"])?;
    if x != 0.0 || y != 0.0 || width > 16384.0 || height > 16384.0 {
        return Err("Invalid sample viewport".into());
    }
    let chat = !sample["chatBounds"].is_null();
    let mut scaled = Vec::with_capacity(12);
    for name in ["mapBounds", "eyeBounds", "chatBounds"] {
        if name == "chatBounds" && !chat {
            break;
        }
        let [x, y, w, h] = rect(&sample[name])?;
        if x + w > width || y + h > height {
            return Err("Sample area outside viewport".into());
        }
        scaled.extend_from_slice(&[x / width, y / height, w / width, h / height]);
    }
    Ok((scaled, chat))
}

pub(crate) fn capture(window: &WebviewWindow, sample: &Value) -> Result<Frame, String> {
    let (areas, has_chat) = regions(sample)?;
    let (send, receive) = mpsc::sync_channel(1);
    window
        .with_webview(move |webview| {
            let callback = RcBlock::new(
                move |bytes: *const u8, length: usize, signatures: *const u8, status: i32| {
                    let result = if status == 0
                        && !bytes.is_null()
                        && length > 0
                        && length <= 16 * 1024 * 1024
                        && !signatures.is_null()
                    {
                        // NSData and each 32-byte digest are retained for this synchronous callback.
                        let digest = |i: usize| {
                            unsafe { std::slice::from_raw_parts(signatures.add(i * 32), 32) }
                                .iter()
                                .map(|b| format!("{b:02x}"))
                                .collect::<String>()
                        };
                        Ok(Frame {
                            jpeg: unsafe { std::slice::from_raw_parts(bytes, length) }.to_vec(),
                            map_signature: digest(0),
                            eye_signature: digest(1),
                            chat_signature: has_chat.then(|| digest(2)),
                        })
                    } else {
                        Err(match status {
                            1 => "WebKit could not capture the sample window",
                            2 => "A sample map, leader view or chat crop was blank",
                            _ => "Could not encode the sample window",
                        }
                        .to_string())
                    };
                    let _ = send.send(result);
                },
            );
            // with_webview runs on the main thread. The bridge copies the region values
            // immediately, and WebKit owns the completion block until it finishes.
            unsafe {
                a2acraft_snapshot(
                    webview.inner().cast(),
                    areas.as_ptr(),
                    areas.len() / 4,
                    &callback,
                );
            }
        })
        .map_err(|e| e.to_string())?;
    receive
        .recv_timeout(Duration::from_secs(9))
        .map_err(|_| "The sample snapshot timed out".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn retina_crops_use_relative_viewport_coordinates_and_reject_out_of_bounds() {
        let bounds = json!({"x":0,"y":0,"width":800,"height":400});
        let mut s = json!({"bounds":bounds,"mapBounds":bounds,
            "eyeBounds":{"x":400,"y":0,"width":200,"height":100}});
        let (areas, chat) = regions(&s).unwrap();
        assert!(!chat);
        assert_eq!(&areas[4..], &[0.5, 0.0, 0.25, 0.25]);
        s["chatBounds"] = json!({"x":50,"y":0,"width":750,"height":400});
        assert!(regions(&s).unwrap().1);
        s["chatBounds"]["width"] = json!(751);
        assert!(regions(&s).is_err());
    }
}
