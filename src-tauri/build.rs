fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rerun-if-changed=src/sample_snapshot.m");
        cc::Build::new()
            .file("src/sample_snapshot.m")
            .flag("-fobjc-arc")
            .flag("-fblocks")
            .compile("a2acraft_sample_snapshot");
        for framework in ["WebKit", "AppKit", "CoreGraphics", "ImageIO"] {
            println!("cargo:rustc-link-lib=framework={framework}");
        }
    }
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["desktop_request"])),
    )
    .expect("failed to build desktop permissions");
}
