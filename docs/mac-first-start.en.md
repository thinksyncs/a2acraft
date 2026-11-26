# First launch on Mac

[日本語](mac-first-start.md)

Download the Apple Silicon ZIP linked in the [README](../README.md). Compare its SHA-256 with the one in the linked release notes. In Finder, double-click the ZIP, drag **A2ACraft.app** to **Applications**, and open it. Official Mac releases require Developer ID signing and Apple notarization. See the README for supported macOS versions and Apple’s first-launch instructions.

## Choose your language

Starting with 0.4.25, the Connect screen follows your preferred supported language. Choose **English** or **日本語** in the language menu. You can change it later in **Settings → Language**. The choice is saved for the next launch. Your conversations, imported messages, project names, and unsent drafts keep their original text.

## Talk to Codex and create a file

1. Select **Connect** and finish signing in to ChatGPT in your browser. Return to A2ACraft and open a new chat.
2. Send “Say hello in one sentence.” Check that a reply appears.
3. In the same chat, open **＋ → Work scope → Work (dedicated folder)**.
4. Send “Create `hello.txt` in this chat’s dedicated folder. Write just one line, `Hello from A2ACraft`, and tell me its absolute path.”
5. In Finder press **⇧⌘G** and paste the folder path from the reply. Open `hello.txt` and check its contents.

You can explore the sample village using **Open offline**. Live Codex replies and file creation require a connection. If the connection check reports a managed policy error, its diagnostic identifies the failed check. A dedicated workspace can be selected in Settings.
