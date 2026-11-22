# GLib 0.18.5 backport

This directory contains the official `glib` 0.18.5 crate from
<https://static.crates.io/crates/glib/glib-0.18.5.crate>.
Its archive SHA-256 is
`233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5`.
The original license, copyright, package version and source are retained.

The only upstream source change is the two-line fix in
`src/variant_iter.rs` from gtk-rs-core commit
[`b5a4071e439bef2b5eea76c3aa25e5ae84839e34`](https://github.com/gtk-rs/gtk-rs-core/commit/b5a4071e439bef2b5eea76c3aa25e5ae84839e34):
make the output pointer mutable and pass `&mut p` to `g_variant_get_child`.
This addresses [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html)
and [GHSA-wrw7-89jp-8q8g](https://github.com/advisories/GHSA-wrw7-89jp-8q8g).

Tauri's GTK 0.18 dependency requires this GLib series. GLib 0.20 is not a
compatible replacement. The application manifest overrides the registry
package with this local copy for all consumers. Remove the override and this
directory once the Tauri dependency graph supports a patched registry release.

macOS Tauri does not compile the GTK stack. Test this backport separately,
with native GLib development libraries available to `pkg-config`:

```sh
cargo test --release --manifest-path test/glib-regression/Cargo.toml --locked
```

The regression harness covers both iteration directions, skipping, mixed
iteration, empty and Unicode strings, overflow and non-string variants.
Release optimization is necessary to expose the original undefined behavior.
An absent registry alert alone does not validate a local path dependency;
keep the source provenance and regression check when updating this copy.
