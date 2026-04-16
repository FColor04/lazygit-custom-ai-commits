# bunnai

<p align="center">
  <img src="https://github.com/chhoumann/bunnai/assets/29108628/1ec69e68-7d5e-4a4d-b4d6-56e202e1c54c">
</p>

have ai write commit messages for you in [lazygit](https://github.com/jesseduffield/lazygit).

uses openai-compatible providers to generate commit message suggestions based on the diff between the current branch and master.
then you can select a commit message from the list and use it to commit your changes.

## installation

```sh
bun install -g @chhoumann/bunnai
```

set up with your provider, api key, and preferred model:

```sh
bunnai config
```

for OpenRouter, choose `Provider -> OpenRouter (free models)` in config and set `OpenRouter API Key`.
the model picker will show only free OpenRouter models.

### windows cmd usage

you can run `bunnai` directly from `cmd.exe`.

1. install bun (required runtime):
```bat
powershell -c "irm bun.sh/install.ps1 | iex"
```
2. ensure Bun is in `PATH` (usually `C:\Users\<you>\.bun\bin`).
3. install bunnai globally (pick one):
```bat
bun install -g @chhoumann/bunnai
```
or
```bat
npm install -g @chhoumann/bunnai
```
4. ensure npm global bin is in `PATH` when using npm install (usually `%AppData%\npm`).
5. verify:
```bat
bunnai --help
```

if `bunnai` is not found in a new terminal, add these to user `PATH` and reopen `cmd`:

```bat
setx PATH "%PATH%;%USERPROFILE%\.bun\bin;%AppData%\npm"
```

## usage

you can specify custom templates. use `bunnai config` to edit the templates.
when you invoke `bunnai`, you can specify a template name to use with `--template`.

### as a menu

this creates a menu of commit messages based on the diff between the current branch and master.

insert the following custom command into your [lazygit](https://github.com/jesseduffield/lazygit) config file (`~/.config/lazygit/config.yml` on linux/mac, `%APPDATA%\lazygit\config.yml` on windows):

```yaml
customCommands:
    - key: "<c-a>" # ctrl + a
        description: "pick AI commit"
        command: 'git commit -m "{{.Form.Msg}}"'
        context: "files"
        prompts:
            - type: "menuFromCommand"
            title: "ai Commits"
            key: "Msg"
            command: "bunnai"
            filter: '^(?P<number>\d+)\.\s(?P<message>.+)$'
            valueFormat: "{{ .message }}"
            labelFormat: "{{ .number }}: {{ .message | green }}"
```

### with vim

this allows you to edit the commit message in vim after you've selected it from the menu.

abort comitting by deleting the commit message in vim.

```yaml
customCommands:
    - key: "<c-a>" # ctrl + a
      description: "Pick AI commit"
      command: 'echo "{{.Form.Msg}}" > .git/COMMIT_EDITMSG && vim .git/COMMIT_EDITMSG && [ -s .git/COMMIT_EDITMSG ] && git commit -F .git/COMMIT_EDITMSG || echo "Commit message is empty, commit aborted."'
      context: "files"
      subprocess: true
      prompts:
          - type: "menuFromCommand"
            title: "AI Commits"
            key: "Msg"
            command: "bunnai"
            filter: '^(?P<number>\d+)\.\s(?P<message>.+)$'
            valueFormat: "{{ .message }}"
            labelFormat: "{{ .number }}: {{ .message | green }}"
```

### lazyvim guide

1. install lazygit and bunnai first (`bunnai --help` should work in your shell).
2. enable lazygit in LazyVim:

create `~/.config/nvim/lua/plugins/lazygit.lua` (linux/mac) or `%LOCALAPPDATA%\nvim\lua\plugins\lazygit.lua` (windows):

```lua
return {
  { "kdheepak/lazygit.nvim", cmd = { "LazyGit", "LazyGitCurrentFile" } },
}
```

3. add a keymap to open lazygit:

add to `~/.config/nvim/lua/config/keymaps.lua` (linux/mac) or `%LOCALAPPDATA%\nvim\lua\config\keymaps.lua` (windows):

```lua
vim.keymap.set("n", "<leader>gg", "<cmd>LazyGit<cr>", { desc = "LazyGit" })
```

4. keep the lazygit `customCommands` config from this README so `<c-a>` offers AI commit suggestions inside lazygit, including when opened from LazyVim.

## acknowledgements

check out these other projects that inspired this one:

-   https://github.com/BuilderIO/ai-shell
