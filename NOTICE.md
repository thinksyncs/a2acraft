# A2ACraft — third-party software notices

A2ACraft includes separately licensed software and fonts. Their license terms
apply to those components. This notice does not grant a blanket license to the
A2ACraft application source, original artwork, or concept films.

The Mac application carries the collected notices in
`A2ACraft.app/Contents/Resources/licenses/`. `NOTICE-INDEX.json` records reviewed
versions, notice hashes, upstream sources, and the scope of the collection.
Electron's supplied `LICENSES.chromium.html` is included unchanged. Runtime npm
and font license texts are preserved alongside it.

The included official Codex CLI is version 0.169.0, published by OpenAI under
Apache-2.0. Its source tag is `rust-v0.169.0`, commit
`d32063f96c2dff1dc96af839b3952abb6acfeda4`. Codex and its bundled ripgrep notices
are included. The original voice runtime notice, licenses, source manifest, and
build manifest are retained within the complete Codex runtime and indexed in
the collected notices. Inclusion of a runtime library does not imply that
A2ACraft exposes its optional voice features.

The Xberg 1.3.7 package includes native libraries with separate licenses.
The upstream macOS build recipe at commit
`cf114034593096670ffc3975dcc062eea57df9cb` pins libde265 1.0.16, libaom 3.12.1,
and libheif 1.23.0. ONNX Runtime is 1.24.2. Their exact license texts and source
links are included. The LGPL libraries remain separately linked dynamic
libraries; their licenses and applicable rights to modify/debug them are not
limited by this notice. The Xberg upstream native-library notice also identifies
its statically linked components, including the source locations and MPL-2.0
licensing choice for libwpd/librevenge.

This collection preserves identified upstream notices. It is not an assertion
that every Rust crate compiled into the prebuilt Xberg and Codex binaries has
been independently audited. That transitive inventory remains part of the
general-release review.

The public [A2ACraft film credits](https://github.com/thinksyncs/a2acraft/blob/main/CREDITS.md)
cover the concept films and named narration/music components. Those media
permissions are separate from application code licensing. The Mac runtime does
not include those concept films, speech model weights, or their narration tools.
