#include <CoreFoundation/CoreFoundation.h>
#include <CoreGraphics/CGSession.h>
#include <mach-o/dyld.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sysexits.h>
#include <unistd.h>

// Electron initializes AppKit before loading the application's JavaScript.
// A headless macOS launch can abort inside _RegisterApplication at that point.
int main(int argc, char *argv[]) {
    (void)argc;
    const char *node_mode = getenv("ELECTRON_RUN_AS_NODE");
    if (node_mode == NULL || strcmp(node_mode, "1") != 0) {
        CFDictionaryRef session = CGSessionCopyCurrentDictionary();
        if (session == NULL) {
            fputs("A2ACraft: macOSの画面セッションに接続できません。"
                  "ログイン中のMacのデスクトップからA2ACraft.appを開いてください。\n", stderr);
            return EX_UNAVAILABLE;
        }
        CFRelease(session);
    }

    char executable[PATH_MAX], runtime[PATH_MAX];
    uint32_t capacity = sizeof(executable);
    if (_NSGetExecutablePath(executable, &capacity) != 0 || realpath(executable, runtime) == NULL) {
        fputs("A2ACraft: アプリの起動場所を確認できません。\n", stderr);
        return EX_OSERR;
    }
    char *basename = strrchr(runtime, '/');
    static const char runtime_name[] = "A2ACraftRuntime";
    if (basename == NULL || (size_t)(basename + 1 - runtime) + sizeof(runtime_name) > sizeof(runtime)) {
        fputs("A2ACraft: アプリの起動パスが不正です。\n", stderr);
        return EX_OSERR;
    }
    memcpy(basename + 1, runtime_name, sizeof(runtime_name));
    argv[0] = runtime;
    execv(runtime, argv);
    perror("A2ACraft: Electronの起動に失敗しました");
    return EX_OSERR;
}
