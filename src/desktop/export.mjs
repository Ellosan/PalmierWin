import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { durationOf, validateProject } from "../core/project.mjs";

const n = (value) => Number(value.toFixed(6)).toString();
const escapeFilter = (value) =>
  value.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "'\\''");
function animated(c, property, fps, variable = "t") {
  const keys = c.keyframes
    .filter((k) => k.property === property)
    .sort((a, b) => a.frame - b.frame);
  if (!keys.length) return n(c.props[property]);
  let expression = n(keys.at(-1).value);
  for (let i = keys.length - 1; i > 0; i--) {
    const a = keys[i - 1],
      b = keys[i];
    expression = `if(lt(${variable},${n(b.frame / fps)}),${n(a.value)}+(${n(b.value - a.value)})*(${variable}-${n(a.frame / fps)})/${n((b.frame - a.frame) / fps)},${expression})`;
  }
  return `if(lt(${variable},${n(keys[0].frame / fps)}),${n(keys[0].value)},${expression})`;
}
function atempo(speed) {
  const filters = [];
  while (speed > 2) {
    filters.push("atempo=2");
    speed /= 2;
  }
  while (speed < 0.5) {
    filters.push("atempo=0.5");
    speed /= 0.5;
  }
  filters.push(`atempo=${n(speed)}`);
  return filters.join(",");
}
async function defaultFont() {
  const fonts =
    process.platform === "win32"
      ? ["C:/Windows/Fonts/segoeuib.ttf", "C:/Windows/Fonts/arial.ttf"]
      : [
          "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
          "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf",
        ];
  for (const font of fonts) {
    try {
      await access(font);
      return font;
    } catch {}
  }
  throw new Error("No supported system font was found for text export.");
}

export async function buildExport(
  project,
  { output, codec = "h264", resolvePath, workdir },
) {
  validateProject(project);
  if (!project.clips.length)
    throw new Error("Add a clip to the timeline before exporting.");
  if (!["h264", "h265", "prores"].includes(codec))
    throw new Error("Unsupported export codec.");
  const fps = project.fps,
    total = durationOf(project) / fps;
  const width = project.width + (project.width % 2),
    height = project.height + (project.height % 2);
  const args = [
    "-hide_banner",
    "-y",
    "-filter_complex_threads",
    "1",
    "-f",
    "lavfi",
    "-i",
    `color=c=black:s=${width}x${height}:r=${fps}:d=${n(total)}`,
  ];
  const filters = ["[0:v]format=rgba[base]"];
  let input = 1,
    visual = "base";
  const audio = [];
  const tracks = project.tracks;
  // Bottom video tracks first; the uppermost track is composited last.
  const sorted = [...project.clips].sort(
    (a, b) =>
      tracks.findIndex((t) => t.id === b.trackId) -
        tracks.findIndex((t) => t.id === a.trackId) || a.start - b.start,
  );
  for (const c of sorted) {
    const track = tracks.find((t) => t.id === c.trackId);
    if (track.hidden) continue;
    const duration = c.duration / fps,
      start = c.start / fps,
      label = `c${input}`;
    let index = input;
    if (c.type === "text") {
      const file = join(
        workdir,
        `title-${c.id.replace(/[^a-z0-9-]/gi, "")}.txt`,
      );
      await writeFile(file, c.text);
      args.push(
        "-f",
        "lavfi",
        "-i",
        `color=c=black@0:s=${width}x${height}:r=${fps}:d=${n(duration)},format=rgba`,
      );
      const font = await defaultFont();
      filters.push(
        `[${index}:v]drawtext=fontfile='${escapeFilter(font)}':textfile='${escapeFilter(file)}':expansion=none:fontsize=${c.fontSize}:fontcolor=${c.color.replace("#", "0x")}:x=(w-text_w)/2:y=(h-text_h)/2[${label}text]`,
      );
    } else {
      const media = project.media.find((m) => m.id === c.mediaId),
        path = await resolvePath(media);
      if (c.type === "image")
        args.push(
          "-loop",
          "1",
          "-framerate",
          String(fps),
          "-t",
          n(duration),
          "-i",
          path,
        );
      else
        args.push(
          "-ss",
          n(c.in / fps),
          "-t",
          n(duration * c.speed),
          "-i",
          path,
        );
    }
    input++;
    if (c.type !== "audio") {
      const source = c.type === "text" ? `${label}text` : `${index}:v`;
      const scale = animated(c, "scale", fps),
        rotation = animated(c, "rotation", fps);
      const chain = [
        `setpts=(PTS-STARTPTS)/${n(c.speed)}`,
        `fps=${fps}`,
        `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
        "format=rgba",
      ];
      if (c.props.brightness !== 100)
        chain.push(
          `colorchannelmixer=rr=${n(c.props.brightness / 100)}:gg=${n(c.props.brightness / 100)}:bb=${n(c.props.brightness / 100)}`,
        );
      if (c.props.contrast !== 100 || c.props.saturation !== 100)
        chain.push(
          `eq=contrast=${n(c.props.contrast / 100)}:saturation=${n(c.props.saturation / 100)}`,
          "format=rgba",
        );
      if (scale !== "100")
        chain.push(
          `scale=w='max(2,trunc(iw*(${scale})/100/2)*2)':h='max(2,trunc(ih*(${scale})/100/2)*2)':eval=frame`,
        );
      if (rotation !== "0")
        chain.push(
          `rotate='(${rotation})*PI/180':ow='hypot(iw,ih)':oh='hypot(iw,ih)':c=none`,
        );
      const alpha = animated(c, "opacity", fps, "T");
      if (c.keyframes.some((k) => k.property === "opacity"))
        chain.push(
          `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*(${alpha})/100'`,
        );
      else if (c.props.opacity !== 100)
        chain.push(`colorchannelmixer=aa=${n(c.props.opacity / 100)}`);
      if (c.props.fadeIn)
        chain.push(`fade=t=in:st=0:d=${n(c.props.fadeIn / fps)}:alpha=1`);
      if (c.props.fadeOut)
        chain.push(
          `fade=t=out:st=${n((c.duration - c.props.fadeOut) / fps)}:d=${n(c.props.fadeOut / fps)}:alpha=1`,
        );
      chain.push(`setpts=PTS+${n(start)}/TB`);
      filters.push(`[${source}]${chain.join(",")}[${label}v]`);
      // Overlay uses timeline time. Animated transforms use clip-relative time.
      const x = animated(c, "x", fps, `(t-${n(start)})`),
        y = animated(c, "y", fps, `(t-${n(start)})`);
      const next = `layer${index}`;
      filters.push(
        `[${visual}][${label}v]overlay=x='(W-w)/2+W*(${x})/100':y='(H-h)/2+H*(${y})/100':enable='gte(t,${n(start)})*lt(t,${n(start + duration)})':eof_action=pass:repeatlast=0[${next}]`,
      );
      visual = next;
    }
    const media = project.media.find((m) => m.id === c.mediaId);
    if (
      !track.muted &&
      (c.type === "audio" || (c.type === "video" && media.hasAudio))
    ) {
      const volume = animated(c, "volume", fps);
      const chain = [
        "asetpts=PTS-STARTPTS",
        atempo(c.speed),
        `atrim=duration=${n(duration)}`,
        `volume='(${volume})/100':eval=frame`,
      ];
      if (c.props.fadeIn) chain.push(`afade=t=in:d=${n(c.props.fadeIn / fps)}`);
      if (c.props.fadeOut)
        chain.push(
          `afade=t=out:st=${n((c.duration - c.props.fadeOut) / fps)}:d=${n(c.props.fadeOut / fps)}`,
        );
      chain.push(`adelay=${Math.round(start * 1000)}:all=1`);
      filters.push(`[${index}:a]${chain.join(",")}[${label}a]`);
      audio.push(`[${label}a]`);
    }
  }
  filters.push(`[${visual}]format=yuv420p[outv]`);
  if (audio.length)
    filters.push(
      `${audio.join("")}amix=inputs=${audio.length}:normalize=0:duration=longest,apad,atrim=duration=${n(total)}[outa]`,
    );
  const script = join(workdir, "filters.txt");
  await writeFile(script, filters.join(";\n"));
  args.push("-filter_complex_script", script, "-map", "[outv]");
  if (audio.length)
    args.push(
      "-map",
      "[outa]",
      "-c:a",
      codec === "prores" ? "pcm_s16le" : "aac",
    );
  else args.push("-an");
  if (codec === "h264")
    args.push(
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "18",
      "-movflags",
      "+faststart",
    );
  if (codec === "h265")
    args.push(
      "-c:v",
      "libx265",
      "-preset",
      "medium",
      "-crf",
      "22",
      "-tag:v",
      "hvc1",
      "-movflags",
      "+faststart",
    );
  if (codec === "prores")
    args.push(
      "-c:v",
      "prores_ks",
      "-profile:v",
      "3",
      "-pix_fmt",
      "yuv422p10le",
    );
  args.push(
    "-t",
    n(total),
    "-r",
    String(fps),
    "-progress",
    "pipe:1",
    "-nostats",
    output,
  );
  return { args, total };
}

export async function renderProject(
  project,
  { binary, output, codec, resolvePath, onProgress = () => {}, signal },
) {
  const workdir = await mkdtemp(join(tmpdir(), "palmierwin-export-"));
  try {
    const { args, total } = await buildExport(project, {
      output,
      codec,
      resolvePath,
      workdir,
    });
    await new Promise((resolve, reject) => {
      const child = spawn(binary, args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let error = "",
        pending = "";
      const abort = () => child.kill();
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) child.kill();
      child.stdout.on("data", (chunk) => {
        pending += chunk;
        const lines = pending.split("\n");
        pending = lines.pop();
        for (const line of lines)
          if (line.startsWith("out_time_us="))
            onProgress(
              Math.min(
                99,
                Math.round((Number(line.split("=")[1]) / 1e6 / total) * 100),
              ),
            );
      });
      child.stderr.on("data", (chunk) => {
        error = (error + chunk).slice(-12000);
      });
      child.on("error", reject);
      child.on("close", (code) => {
        signal?.removeEventListener("abort", abort);
        if (code === 0) {
          onProgress(100);
          resolve();
        } else
          reject(
            new Error(
              signal?.aborted
                ? "Export cancelled."
                : `FFmpeg export failed: ${error.slice(-3000)}`,
            ),
          );
      });
    });
    return output;
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}
