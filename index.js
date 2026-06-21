import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync, exec } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const UPLOADS_DIR = '/tmp/uploads';
const VIDEOS_DIR = '/tmp/videos';

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(VIDEOS_DIR, { recursive: true });

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);
    protocol.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(destPath); });
    }).on('error', reject);
  });
}

async function searchClaudeInfo(topic) {
  return {
    aiTips: "Utilise des transitions fluides entre les scènes",
    automationTrick: "Automatise le rendu vidéo avec FFmpeg en batch processing",
    keywords: ["AI", "automation", "workflow"]
  };
}

// scale: 0.0 to 1.0, where 1.0 = plein écran, 0.35 = 35% de la hauteur
async function composeAvatarLocal(avatarPath, audioPath, scale = 0.35) {
  const outputName = `avatar-composed-${Date.now()}.mp4`;
  const outputPath = path.join(VIDEOS_DIR, outputName);

  // Scale avatar to `scale` of its original size, keep 9:16 ratio, pad to 1080x1920
  // trunc(...)*2 ensures even pixel dimensions required by H.264
  const scaleW = `trunc(1080*${scale}/2)*2`;
  const scaleH = `trunc(1920*${scale}/2)*2`;

  const filterComplex = `[0:v]scale=${scaleW}:${scaleH}:flags=lanczos[scaled];[scaled]pad=1080:1920:(1080-iw)/2:(1920-ih)/2:color=black[out]`;
  const audioParts = audioPath ? [`-i "${audioPath}"`, '-map 1:a', '-c:a aac -b:a 128k -shortest'] : [];

  const cmd = [
    'ffmpeg -y',
    `-i "${avatarPath}"`,
    ...audioParts.slice(0, 1),
    `-filter_complex "${filterComplex}"`,
    '-map "[out]"',
    ...audioParts.slice(1),
    '-c:v libx264 -preset fast -crf 23',
    '-pix_fmt yuv420p',
    `"${outputPath}"`
  ].filter(Boolean).join(' ');

  console.log(`[Compose] scale=${scale} → ${outputName}`);
  execSync(cmd, { stdio: 'pipe' });

  return outputPath;
}

async function sendEmail(toEmail, videoUrl) {
  console.log(`[Email] Sending to ${toEmail}: ${videoUrl}`);
  return { sent: true, to: toEmail };
}

function getBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function serveStaticFile(res, filePath, contentType) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'File not found' }));
    return;
  }
  const stat = fs.statSync(filePath);
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': stat.size,
    'Access-Control-Allow-Origin': '*'
  });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // Route: POST /upload?filename=xxx — raw binary upload (no multer needed)
  if (req.method === 'POST' && pathname === '/upload') {
    const filename = url.searchParams.get('filename') || `upload-${Date.now()}.png`;
    const safeName = path.basename(filename);
    const destPath = path.join(UPLOADS_DIR, safeName);
    const file = fs.createWriteStream(destPath);

    req.pipe(file);
    file.on('finish', () => {
      const host = req.headers.host || `localhost:${PORT}`;
      const fileUrl = `http://${host}/uploads/${safeName}`;
      console.log(`[Upload] Saved: ${destPath} → ${fileUrl}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, url: fileUrl, filename: safeName }));
    });
    file.on('error', (err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

  // Route: GET /uploads/:filename — serve uploaded files
  if (req.method === 'GET' && pathname.startsWith('/uploads/')) {
    const filename = path.basename(pathname);
    serveStaticFile(res, path.join(UPLOADS_DIR, filename), 'image/png');
    return;
  }

  // Route: GET /videos/:filename — serve generated videos
  if (req.method === 'GET' && pathname.startsWith('/videos/')) {
    const filename = path.basename(pathname);
    serveStaticFile(res, path.join(VIDEOS_DIR, filename), 'video/mp4');
    return;
  }

  // Route: POST /slideshow — create video slideshow from image URLs
  if (req.method === 'POST' && pathname === '/slideshow') {
    try {
      const body = await getBody(req);
      const { imageUrls, duration = 3, outputFilename } = JSON.parse(body);

      if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'imageUrls array is required' }));
        return;
      }

      const slideDir = `/tmp/slides-${Date.now()}`;
      fs.mkdirSync(slideDir, { recursive: true });

      console.log(`[Slideshow] Downloading ${imageUrls.length} images...`);
      for (let i = 0; i < imageUrls.length; i++) {
        const dest = path.join(slideDir, `slide-${String(i + 1).padStart(3, '0')}.png`);
        await downloadFile(imageUrls[i], dest);
        console.log(`[Slideshow] ✓ Image ${i + 1}/${imageUrls.length}`);
      }

      const videoName = outputFilename || `slideshow-${Date.now()}.mp4`;
      const videoPath = path.join(VIDEOS_DIR, videoName);

      console.log(`[Slideshow] Creating video with ffmpeg...`);
      execSync(
        `ffmpeg -y -framerate 1/${duration} -i "${slideDir}/slide-%03d.png" ` +
        `-vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=25" ` +
        `-c:v libx264 -pix_fmt yuv420p "${videoPath}"`,
        { stdio: 'pipe' }
      );

      fs.rmSync(slideDir, { recursive: true });

      const host = req.headers.host || `localhost:${PORT}`;
      const videoUrl = `http://${host}/videos/${videoName}`;
      console.log(`[Slideshow] ✅ Done: ${videoUrl}`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, videoUrl, filename: videoName }));
    } catch (error) {
      console.error('[Slideshow] Error:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // Route: POST /avatar/generate
  if (req.method === 'POST' && pathname === '/avatar/generate') {
    try {
      const body = await getBody(req);
      const params = JSON.parse(body);
      const { avatarUrl, voiceUrl, topic, userEmail, avatarScale = 0.35 } = params;

      const scale = Math.min(1.0, Math.max(0.1, parseFloat(avatarScale)));

      console.log('\n═══════════════════════════════════════');
      console.log('🎬 AVATAR AI WEBHOOK - PROCESSING');
      console.log(`Topic: ${topic} | Email: ${userEmail} | Scale: ${scale}`);

      const claudeInfo = await searchClaudeInfo(topic);
      const videoPath = await downloadFile(avatarUrl, `/tmp/avatar-${Date.now()}.mp4`);
      const audioPath = voiceUrl ? await downloadFile(voiceUrl, `/tmp/voice-${Date.now()}.mp3`) : null;

      const composedPath = await composeAvatarLocal(videoPath, audioPath, scale);

      const host = req.headers.host || `localhost:${PORT}`;
      const videoUrl = `http://${host}/videos/${path.basename(composedPath)}`;

      await sendEmail(userEmail, videoUrl);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: "success",
        data: { videoUrl, topic, claudeInfo, avatarScale: scale, email: { to: userEmail, status: "sent" }, timestamp: new Date().toISOString() }
      }));
    } catch (error) {
      console.error('[Avatar] Error:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: "error", message: error.message }));
    }
    return;
  }

  // Health check
  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: "ok", endpoints: ["/upload", "/uploads/:filename", "/videos/:filename", "/slideshow", "/avatar/generate"] }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ message: "Not found", endpoints: ["POST /upload?filename=xxx", "GET /uploads/:filename", "GET /videos/:filename", "POST /slideshow", "POST /avatar/generate", "GET /health"] }));
});

server.listen(PORT, () => {
  console.log(`\n🚀 Avatar API running on http://localhost:${PORT}`);
});

export default server;
