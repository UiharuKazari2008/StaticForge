# Einheitliche Build-Umgebung (StaticForge, Android-App, Windows-App) - Plan zur Abnahme

Issue: DreamScape/StaticForge#1139 (Master #1078). Entwurf einer Claude-Code-Sitzung, 24.11.2026. Noch nichts davon ist umgesetzt; Yukimi nimmt den Plan ab, danach kommen die Schritte als eigene Issues.

## 1. Ist-Zustand (am 24.11.2026 im Repo gemessen)

**Ein Live-Baum, viele Schreiber.** `/home/kanmi/staticforge` ist zugleich Arbeitsbaum aller Agenten und der Baum, aus dem pm2 `web_server.js` ausliefert (`ecosystem.config.js`, `cwd: __dirname`). Jede Datei, die ein Agent speichert, ist sofort live, und jeder andere Agent sieht sie halb fertig in `git status`.

- Der Status zu Beginn dieser Sitzung zeigt 11 geaenderte und 12 unversionierte Dateien, die mehrere Sitzungen gleichzeitig angefasst haben (Fleet, Bilder, Director, Contractor-Skripte, dazu Python-Wheels im Wurzelordner).
- 34 lokale Commits auf `main` sind nicht auf `origin/main` (`git log origin/main..HEAD`). Dort liegt Arbeit anderer Sitzungen, die nur lokal existiert. Ein Plattenschaden oder ein `reset` loescht sie.
- Commits der letzten 7 Tage: 1373, davon 1253 unter `Yukimi Kazari` (die Git-Identitaet des Hosts), nur 10 `Claude`, 67 `Claude Code`, 15 `Menma`. **Die Urheberschaft ist im Verlauf nicht lesbar**, weil fast alle Agenten unter derselben Identitaet committen.
- 110 Branches, davon viele alte `cursor/*`, `claude/*`, `menma/*`, auf zwei Remotes (`origin` = Yozora, `Public` = GitHub). Mehrere Zweige sind nie gemergt worden und enthalten teils die einzige Kopie einer Behebung.
- Sechs Worktrees existieren, ohne Ordnung: `~/.cache/claude-run/sf-menu-fix`, `~/opt/staticforge-main` (Stand 15.10., detached), `~/wt/n22`, `~/wt/n23`, `~/wt/sf-n23plan`. Niemand weiss, welcher noch gebraucht wird.

**Schutzmassnahmen, die schon da sind, aber nur Hinweise sind:**
- `.agent-<id>`-Sperrdatei (Regel `agent-busy-lock`) und `agent-coord` (`coord_claim`, Build-Gates): wirkt nur, wenn der Agent es benutzt; zwingt nichts. Ein Claim sperrt keine Datei im Dateisystem.
- Pre-commit-Hook `.githooks/pre-commit` (Perf-Regeln, Status-Icons): prueft Inhalt, nicht Herkunft oder Aktualitaet.
- Regel `no-stash-to-pretty-commit`, `commit-each-turn`: gute Gewohnheiten, ohne technische Durchsetzung.

**Android-App (DSApp-Kotlin, eigenes Repo).** Regel `android-app-builds`: Build nur auf Ruiko, aus `origin/main` plus *allen* ungemergten Branches (`build/latest`), von Hand zusammengefuehrt. Das ist die Regressionsquelle schlechthin: ein vergessener Branch oder ein alter `claude-build\dsapp-*`-Ordner bringt alte Fehler zurueck (Beleg: der alte Splash vom 13.11.). Die CaféReady-Aufgaben unter `public/scripts/tasks/` leben in StaticForge **und** als Kopie in DSApp (`sync-cafe-tasks.js`); der Hook warnt nur. Zwei Wahrheiten, die auseinanderlaufen.

**Windows-App / DreamOS.** `~/DreamOS` (Repo `DreamScape/DreamOS`, Image-Bau mit mkosi ueber den Remote `build` / Host `dreamos-build`). Der Stand von `~/opt/staticforge-main` (15.10.) zeigt, dass es schon einen zweiten, veralteten StaticForge-Baum neben dem Live-Baum gibt. Ob eine eigene Windows-App neben DreamOS gebaut wird, stand in den Unterlagen nicht; das muss Yukimi klaeren (Frage 1 unten).

**Wie Regressionen entstehen (die vier Muster):**
1. *Ueberschreiben im selben Baum*: zwei Agenten bearbeiten dieselbe Datei; wer zuletzt speichert, gewinnt; der andere merkt es nicht.
2. *Build aus altem Stand*: App oder Client entsteht aus einem Ordner oder Branch, der hinter `main` liegt.
3. *Arbeit nur lokal*: unveroeffentlichte Commits oder `build/*`-Branches gehen beim naechsten Rebase, `reset` oder Plattenwechsel verloren.
4. *Zwei Kopien derselben Sache* (CaféReady-Aufgaben, Doku der WS-Pakete, `public/` gegen App-Assets): eine Seite wird behoben, die andere nicht.

## 2. Vorschlag: getrennte Arbeitsflaechen, ein gemeinsamer Build

### 2.1 Grundsatz
**Jeder Agent arbeitet in einem eigenen git-Worktree auf einem eigenen Branch. Nichts wird im Live-Baum bearbeitet. Alles muendet ueber eine Integrationslinie in genau einen Build, den Menschen und Agenten testen.**

```
 agent-Worktrees  ->  Integrationsbranch `integration`  ->  ein Build (Server + App + Windows/DreamOS)  ->  Test  ->  main
 (je Branch)          (taeglich/pro Merge aufgebaut)         (aus einem SHA, mit Manifest)
```

### 2.2 Arbeitsflaechen
- Ort: `~/wt/<repo>/<agent-id>-<issue>` (ein Ordner, nicht verstreut). Anlegen und Entfernen macht ein Skript `scripts/wt.sh new <issue>` / `done` (auf `agent-coord` aufsetzend: legt den Worktree an, `coord_hello` mit Pfad und Branch, loescht ihn nach dem Merge).
- Branch-Name: `agent/<identitaet>/<issue>-<kurz>`. Ein Branch gehoert einer Sitzung; Zweiter nur nach `coord_post`.
- `node_modules` wird per Hardlink-/pnpm-Store geteilt (pnpm hat das bereits), `data/`, `images/`, `config*.json` bleiben **nur** im Live-Baum und werden nie im Worktree kopiert. Ein Worktree startet einen eigenen Test-Server auf einem eigenen Port (`PORT` aus der Worktree-ID), mit eigenem leeren oder gespiegelten Datenordner.
- Der Live-Baum `/home/kanmi/staticforge` wird zum **Deploy-Ziel**: dort wird nicht mehr bearbeitet, er folgt `main` per `git merge --ff-only`. Das beendet Muster 1 und die halbfertigen Dateien in der Live-Anzeige.

### 2.3 Identitaet und Urheberschaft
- Jede Sitzung committet mit eigener Identitaet (`user.name` = Agent, z. B. `Claude Code (fleet-<id8>)`, `user.email` = `<id>@agents.dream.737.jp.net`); Yukimi bleibt Autorin ihrer eigenen Commits. Die Zeile `Claude-Session:` im Commit-Text (steht schon) bleibt als Beleg.
- Ein Hook `commit-msg` verlangt `#<issue>` im Text. So steht zu jeder Zeile: wer, welche Sitzung, welches Issue.
- `coord_editors` (liest Transkripte) bleibt als Zusatz, ist aber nicht mehr die einzige Quelle.

### 2.4 Die gemeinsame Build-/Testumgebung
Ein **Build-Manifest** `build-manifest.json`, erzeugt bei jedem Bau, beschreibt den Stand lueckenlos:

```
{ "id": "b2026-11-25-01", "staticforge": "<sha>", "dsapp": "<sha>", "dreamos": "<sha>",
  "merged": [ { "branch": "agent/claude/1139-x", "sha": "...", "issue": 1139, "author": "..." } ],
  "left_out": [ { "branch": "...", "why": "..." } ] }
```

- **StaticForge:** `integration` = `main` + alle Branches mit Label `status:review` (oder Abnahme-Haken), die sauber mergen. Ein Skript `scripts/integrate.js` baut das; ein Branch, der nicht mergt, wird mit Grund ausgelassen und dem Besitzer per `coord_post` gemeldet. Der Test-Server der Integration laeuft auf eigenem Port, ueber den auch Menschen testen (derselbe Weg wie die Test-Tabs heute).
- **Android-App:** der Ruiko-Build bekommt `integration` von DSApp-Kotlin (selbes Skript, selbe Regel wie heute, nur automatisch statt von Hand). Das Manifest ersetzt die Handliste aus `android-app-builds`; die Regel bleibt (nur Ruiko, Debug-Key, nie in Schleife installieren).
- **Windows / DreamOS:** `dreamos-update` zieht das Image aus demselben Manifest (StaticForge-SHA fest im Image eingetragen), damit Client und Server nie aus verschiedenen Staenden stammen.
- **Gekoppelte Daten:** CaféReady-Aufgaben nicht mehr kopieren: DSApp holt sie beim Bau aus dem StaticForge-SHA des Manifests (`sync-cafe-tasks.js` laeuft im Build, nicht von Hand); der Hook-Hinweis wird zur CI-Pruefung. Das beendet Muster 4 fuer diese Dateien.
- **Build-Gate:** bleibt `coord_build_request`/`begin`/`end`, wird aber vom Skript aufgerufen. Wer nicht bereit ist, steht im Manifest unter `left_out`.
- **Regressionsfalle:** jede Behebung bekommt einen Test oder eine Pruefzeile in `scripts/` (Muster wie `check-perf-rules.js`); `integrate.js` fuehrt alle aus und blockiert den Bau bei Rot. Ein "wieder da"-Fehler faellt so im Build auf, nicht bei Yukimi.

### 2.5 Besitz und Zusammenfuehren bei Ueberschneidung
1. **Besitz = Claim.** Wer eine Datei aendern will, nimmt `coord_claim`. Neu: `scripts/wt.sh` und der Pre-commit-Hook lehnen einen Commit ab, der eine Datei aendert, die ein *anderer* Agent claimt (der Hook fragt `coord_check`; Notfall nur mit `--force` und Begruendung im Text).
2. **Kleine, haeufige Merges.** Jede Sitzung rebased ihren Branch vor dem Abschluss auf `origin/main` und mergt per Fast-forward oder Squash (`commit-each-turn` bleibt: Zwischenstaende auf dem eigenen Branch, nicht auf `main`). Lange Branches sind das Risiko; Obergrenze: 2 Tage ohne Rebase, dann meldet der Supervisor.
3. **Konflikt:** den Konflikt loest der *spaetere* Branch, der Besitzer des frueheren wird per `coord_post` gefragt, wenn die Absicht unklar ist (`coord_pause_agent` nur fuer die Dauer des Merges). Regel wie in `android-app-builds`: beide Absichten behalten, nie eine Aenderung verwerfen, damit der Merge durchgeht. Das Ergebnis steht im Manifest.
4. **Gleiche Zeilen, zwei Absichten** (Kern der Regressionen): der Merge-Bearbeiter schreibt einen Test fuer *beide* Verhaltensweisen (siehe Regressionsfalle).
5. **Nichts nur lokal:** `commit-each-turn` gilt am Branch; ein taeglicher Job (`scripts/publish-all.sh`) pusht jeden Worktree-Branch nach Yozora. Die 34 lokalen `main`-Commits werden vorher einmal veroeffentlicht (nicht rebasen; Plumbing-Weg, siehe Memory "Publish own commit").

### 2.6 Aufraeumen zum Start (einmalig)
- Die 34 lokalen `main`-Commits pruefen und veroeffentlichen; erst dann Worktrees und Branches antasten.
- Die fuenf alten Worktrees einzeln pruefen (ungepushte Commits, Aenderungen), dann entfernen. `~/opt/staticforge-main` (15.10.) und `~/wt/n22`/`n23` zuerst.
- Die 110 Branches: gemergte loeschen; ungemergte listen und je Besitzer entscheiden (Liste kommt als Anhang zum Issue). Nichts wird ohne Pruefung geloescht.
- Python-Wheels und `core.*`-Dateien im Wurzelordner nach `.gitignore` / entfernen (nur nach Rueckfrage).

## 3. Schritte und Aufwand (jeweils eigenes Issue nach Abnahme)

| # | Schritt | Wer | Risiko |
|---|---|---|---|
| 1 | Alle lokalen Commits und Branches veroeffentlichen, Branch-Liste erstellen | Sitzung, Yukimi prueft | niedrig, wenn ohne Rebase |
| 2 | `scripts/wt.sh` (Worktree + Port + agent-coord), Agenten-Identitaet pro Sitzung | Sitzung | niedrig |
| 3 | Live-Baum auf Deploy-Ziel umstellen (`merge --ff-only` von `main`), Agenten arbeiten nur in Worktrees | Yukimi gibt frei | **mittel**: die Arbeitsweise aller Agenten aendert sich; erst nach 1 und 2 |
| 4 | `integrate.js` + Manifest + Pruefskripte als Build-Schranke | Sitzung | mittel |
| 5 | DSApp-Build automatisch aus dem Manifest (Ruiko), CaféReady-Sync im Build | Sitzung (DSApp) | mittel |
| 6 | DreamOS/Windows-Image zieht denselben Manifest-SHA | Sitzung (DreamOS) | niedrig bis mittel |
| 7 | Hooks: `commit-msg` (#issue), Claim-Pruefung im Pre-commit | Sitzung | niedrig |

Reihenfolge: 1, 2, 7 sofort moeglich ohne den Betrieb zu stoeren; 3 ist der eigentliche Schnitt; 4-6 bauen darauf.

## 4. Offene Fragen an Yukimi (vor der Abnahme)

1. **Windows-App:** ist damit DreamOS (Linux-Image fuer den Laptop) gemeint, oder gibt es eine eigene Windows-Anwendung (Desktop-Client) in einem anderen Repo? Ich habe nur DreamOS gefunden.
2. **Live-Baum:** soll der Live-Baum wirklich zum reinen Deploy-Ziel werden (Schritt 3)? Das ist die wirksamste, aber auch die einschneidendste Aenderung.
3. **Integration:** automatisch alle `status:review`-Branches mergen, oder nur solche, die Yukimi oder ein Agent freigibt?
4. **Identitaeten:** duerfen Agenten unter eigenen Git-Namen committen (statt `Yukimi Kazari`)? Das macht die Urheberschaft lesbar, aendert aber die Anzeige im Verlauf.

## 5. Abnahme
Dieser Plan ist angenommen, wenn Yukimi die Fragen 1-4 beantwortet hat. Erst dann werden die Schritte aus Abschnitt 3 als Issues angelegt und gestartet.
