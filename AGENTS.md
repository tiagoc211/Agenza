# Agent Instructions

All agents working in this repository must run project commands inside the Conda environment named `agenza`.

Use this command format:

```powershell
conda run -n agenza <command>
```

If `conda` is not available on the shell's `PATH`, use:

```powershell
& "C:\Users\Tiago\anaconda3\Scripts\conda.exe" run -n agenza <command>
```

Do not run multiple `conda run` commands concurrently. On Windows, concurrent invocations can collide while using Conda's temporary activation files.

## Project workflow

- Keep `todo.json` updated when a task is started or completed.
- Run the relevant tests, linting, and validation before marking a task as complete.
- Add every new Python dependency to `requirements.txt` and pin its version when practical.
- Preserve existing user changes and avoid unrelated edits.
- Do not create commits, rewrite Git history, or perform other Git history changes unless the user explicitly requests them.

## Release scope

- Release `0.1.0` targets Windows.
- Keep release `0.1.0` focused on two independent embedded terminals that run the Codex CLI.
- Features such as linked agents, additional CLI tools, accounts, and cloud synchronization are out of scope unless the user changes the release scope.

## Terminal safety and privacy

- Ensure terminal child processes and their process trees are terminated when a session restarts or Agenza closes.
- Never store secrets or terminal input in application logs.
