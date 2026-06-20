import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

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

async function composeVideo(videoUrl, audioUrl) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ videoUrl, audioUrl });
    const url = new URL('https://ffmpeg.tonypayet.com/combine');
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          const outputUrl = result.url || result.outputUrl || result.videoUrl;
          if (!outputUrl) throw new Error('No URL in response');
          resolve({ success: true, outputUrl, duration: result.duration || "30s", codec: "h264", format: "mp4" });
        } catch (e) {
          reject(new Error(`FFmpeg API error: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
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
      const { avatarUrl, voiceUrl, topic, userEmail } = params;

      console.log('\n═══════════════════════════════════════');
      console.log('🎬 AVATAR AI WEBHOOK - PROCESSING');
      console.log(`Topic: ${topic} | Email: ${userEmail}`);

      const claudeInfo = await searchClaudeInfo(topic);
      const videoPath = await downloadFile(avatarUrl, `/tmp/${path.basename(avatarUrl.split('?')[0]) || 'avatar.mp4'}`);
      const audioPath = await downloadFile(voiceUrl, `/tmp/${path.basename(voiceUrl.split('?')[0]) || 'voice.mp3'}`);

      const composed = await composeVideo(avatarUrl, voiceUrl);
      await sendEmail(userEmail, composed.outputUrl);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: "success",
        data: { videoUrl: composed.outputUrl, topic, claudeInfo, email: { to: userEmail, status: "sent" }, timestamp: new Date().toISOString() }
      }));
    } catch (error) {
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
