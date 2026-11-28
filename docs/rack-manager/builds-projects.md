# Projects: a repo registers its own builds (`builds` role)

Any repo on Yozora can carry its build pipelines and register itself with Rack Manager. The shipped presets in `services/rackd/pipelines` stay as built-in
pipelines (`source: {builtin: true}`); a project's pipelines are listed as `<project>/<id>` with `source: {project, repo, ref, path, commit}`.

## How a repo adds a pipeline
1. Put `.rack/pipelines/<id>.json` in the repo (one file per pipeline; `id` defaults to the file name) and, when the build needs its own image, the Dockerfile anywhere in the repo.
2. Register the repo once: Rack Manager > server > Builds > Register Project..., or `rack_role {role:'builds', action:'project-register', params:{repo, ref?, name?}}`.
   `repo` is an https URL on Yozora, `ref` defaults to the default branch, `name` to the repo name (lowercase). The role clones/fetches it into `/srv/rack/builds/_projects/<name>`
   and reads `.rack/pipelines/*.json` at that ref. Files that fail validation are listed under the project's `errors`; the others register.
3. Before every run of a project pipeline rackd fetches the project and re-reads the pipeline file (and its Dockerfile) at the run's ref, so a change to the file in the repo
   takes effect on the next run without registering again. A run with another `ref` reads the file at that ref (the stored definition is not changed).

Actions of the role: `projects` (list), `project-register {repo, ref?, name?}`, `project-refresh {name?}` (all projects when omitted), `project-unregister {name, confirm}`,
`project-trust {name, trusted, confirm}`. Fleet needs `confirm: true` for the last two. `GET` of the role also returns `projects:[{name, repo, ref, trusted, fetchedAt, commit, pipelines, errors}]`
and each pipeline carries `project`, `source`, `trusted`. Run it as `run {pipeline:'<project>/<id>', ref?, env?}`. Unregistering removes the registry entry and the clone, not runs or artifacts.
Builds of `<project>/<id>` live in `/srv/rack/builds/<project>--<id>/{src,cache}`; the image is `rack-build-<project>--<id>:<hash of the Dockerfile>`.

## Pipeline schema (same as rackd's presets, minus host paths)
```json
{
  "id": "dsapp-win",
  "name": "Dreamscape VDI (Windows client)",
  "ref": "main",
  "image": "mcr.microsoft.com/dotnet/sdk:10.0",
  "dockerfile": ".rack/dsapp.Dockerfile",
  "script": "shell, runs in the source checkout (/work/src) as bash -eo pipefail",
  "env": { "NAME": "value" },
  "envParams": ["VERSION"],
  "cpus": 8, "memGB": 16, "cacheRamdisk": 0, "timeoutMin": 60,
  "artifacts": ["app/build/outputs/**/*.apk"]
}
```
- One of `image` (an existing image) or `dockerfile` (a path inside the repo, built with no context, tag by content hash) is required. `repo` is always the project's repo; `ref` defaults to the project's ref.
- In the container: `/work/src` is the checkout (clean, detached at the ref), `/cache` a persistent cache folder per pipeline (`HOME=/cache/home`), `/out` the output folder (`RACK_OUT`), `RACK_COMMIT` the commit.
  Everything in `/out` is kept as the run's artifacts; `artifacts` globs (relative to the checkout) are copied in addition. Runs as the unprivileged user `rack`.
- `envParams` lists the env names a caller may set per run (`run {env:{VERSION:'1.2'}}`); no other names are accepted.
- Limits: cpus 1-240, memGB 1-480, timeoutMin up to 4320.

## Secrets policy
- No secrets in the repo or in a pipeline file: no tokens, keys, passwords in `env`, scripts or Dockerfiles. The role clones with its own read-only Yozora credentials (`/etc/rackd/git-credentials`, never visible to the build).
- A build that needs a secret lists a named secret mount: `"secrets": ["dreamos"]` mounts `/etc/rackd/secrets/dreamos` read-only at `/secrets`. The folder is root-only on the host and filled by an operator.
- `privileged` (+ `devMount`), `secrets` and `acceptsInput` (an earlier run's output read-only at `/in`, `run {input:<runId>}`) are ignored unless the project is trusted:
  `project-trust {name, trusted:true}` (an operator decision, needs confirm). Built-in presets are always trusted. Untrusted projects build in an unprivileged container with no secrets.

## DSApp-Win (registered)
`DreamScape/DSApp-Win` carries `.rack/pipelines/dsapp-win.json` on branch `rack-build` (project `dsapp-win`, ref `rack-build`; register with `ref: master` once the branch is merged).
It builds on Linux: the .NET 10 SDK image, `dotnet publish Dreamscape.csproj -c Release -r win-x64 -p:EnableWindowsTargeting=true -o /out` makes the self-contained single file
`Dreamscape VDI.exe` (PE32+, about 50 MB) plus `SHA256SUMS` and `build-info.json`. No Windows VM is needed (the pipeline runner type `windows-vm` was not added). A run takes about 25 s warm cache.
The build only produces the file; releasing it to clients (what the server delivers) is a separate step.

## DreamOS: moving its pipelines into its repo
Today `dreamos`, `dreamos-release` and `dreamos-chromium` are built-in presets in `services/rackd/pipelines`. To make them project pipelines:
1. In the DreamOS repo add `.rack/pipelines/dreamos.json` and `.rack/pipelines/dreamos-release.json` (and `dreamos-chromium.json`): copy the preset JSON, keep `id`, `script`, `env`, `envParams`, `cpus`, `memGB`, `timeoutMin`,
   `privileged`, `devMount`, `secrets`, `acceptsInput`; remove `repo` and `dockerfileFile`, and replace `dockerfileFile` by `"dockerfile": ".rack/dreamos.Dockerfile"` (move `services/rackd/pipelines/dreamos.Dockerfile` there; the chromium preset's Dockerfile too, with its own name).
2. Register: `project-register {repo:'https://yozora.bluesteel.737.jp.net/DreamScape/DreamOS.git', ref:'main', name:'dreamos'}`, then `project-trust {name:'dreamos', trusted:true, confirm:true}`
   (the build needs `privileged`, `devMount` and the `dreamos` secret mount; without trust they are ignored). The release key stays in `/etc/rackd/secrets/dreamos`, root-only on the host.
3. Pipelines then appear as `dreamos/dreamos`, `dreamos/dreamos-release` (run `{pipeline:'dreamos/dreamos-release', input:<runId of the unsigned build>}`). Work folders change to `/srv/rack/builds/dreamos--dreamos`, so the first run clones afresh and the mkosi cache is cold once;
   copy `/srv/rack/builds/dreamos/cache` to the new folder to keep it. Delete the presets from `services/rackd/pipelines` (and redeploy rackd) once the project pipelines ran green, so the names do not exist twice.
Do not do this while the presets are in use by another agent's run; ids differ (`dreamos` vs `dreamos/dreamos`), so both can exist during the move.

## Example for DSApp-Kotlin (not pushed; the built-in `dsapp` preset keeps working)
`.rack/pipelines/dsapp.json`:
```json
{
  "id": "dsapp",
  "name": "DSApp-Kotlin debug APK",
  "ref": "main",
  "dockerfile": ".rack/dsapp.Dockerfile",
  "script": "chmod +x ./gradlew\n./gradlew --no-daemon --console=plain assembleDebug\n",
  "env": { "GRADLE_OPTS": "-Dorg.gradle.jvmargs=-Xmx6g" },
  "cpus": 16,
  "memGB": 24,
  "artifacts": ["app/build/outputs/apk/**/*.apk"],
  "timeoutMin": 120
}
```
with `.rack/dsapp.Dockerfile` = the content of `services/rackd/pipelines/dsapp.Dockerfile` (JDK 21 + Android SDK platform 36). It would register as `dsapp-kotlin/dsapp` (project name from the repo URL).
