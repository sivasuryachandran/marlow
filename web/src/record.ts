import raw from "../../data/eval/commands.jsonl?raw";
import { toWav16k } from "./stt";

const cmds = raw.trim().split("\n").map(l => JSON.parse(l) as { id: string; saidText: string });
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const done = new Set<string>();
let cur = 0, recorder: MediaRecorder | null = null, chunks: Blob[] = [], stream: MediaStream | null = null, busy = false;

function paint() {
  $("list").innerHTML = cmds.map((c, i) => `<li class="${done.has(c.id) ? "done" : ""} ${i === cur ? "cur" : ""}">${c.id}: ${c.saidText}${done.has(c.id) ? " ✓" : ""}</li>`).join("");
  $("fill").style.width = `${(done.size / cmds.length) * 100}%`;
  $("count").textContent = `${done.size} of ${cmds.length} recorded`;
  $("say").textContent = cur < cmds.length ? `“${cmds[cur].saidText}”` : "All done. Run: npm run eval";
  const b = $("rec"); b.classList.toggle("on", !!recorder); b.textContent = recorder ? "Stop and save (Space)" : "Start recording (Space)";
}

async function toggle() {
  if (busy || cur >= cmds.length) return;
  if (!recorder) {
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false } }); }
    catch { $("msg").textContent = "Microphone permission was denied."; return; }
    chunks = []; recorder = new MediaRecorder(stream); recorder.ondataavailable = e => chunks.push(e.data); recorder.start();
    $("msg").textContent = "Recording…"; paint(); return;
  }
  busy = true;
  const r = recorder; recorder = null;
  await new Promise<void>(res => { r.onstop = () => res(); r.stop(); });
  stream?.getTracks().forEach(t => t.stop());
  try {
    const wav = await toWav16k(new Blob(chunks, { type: r.mimeType }));
    const id = cmds[cur].id;
    const res = await fetch(`/api/eval-audio/${id}`, { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav });
    if (!res.ok) throw new Error(String(res.status));
    done.add(id); $("msg").textContent = `Saved ${id} (${Math.round(wav.size / 1024)} KB).`; cur++;
  } catch (e) { $("msg").textContent = `Save failed (${e}). Is npm run server running? Try again.`; }
  busy = false; paint();
}

document.addEventListener("keydown", e => {
  if (e.code === "Space") { e.preventDefault(); if (!e.repeat) void toggle(); }
  else if (e.key.toLowerCase() === "r" && !recorder && cur > 0) { cur--; done.delete(cmds[cur].id); paint(); }
  else if (e.key.toLowerCase() === "s" && !recorder) { cur = Math.min(cmds.length, cur + 1); paint(); }
});
$("rec").addEventListener("click", () => void toggle());
fetch("/api/eval-audio").then(r => r.json()).then((ids: string[]) => { ids.forEach(i => done.add(i)); cur = Math.max(0, cmds.findIndex(c => !done.has(c.id))); if (cur < 0) cur = cmds.length; paint(); }).catch(() => { $("msg").textContent = "Server not reachable: start npm run server."; paint(); });
paint();
