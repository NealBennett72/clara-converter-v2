const { execFileSync } = require('child_process');
const { writeFileSync, readFileSync, unlinkSync } = require('fs');
const { join } = require('path');
const ffmpegPath = require('ffmpeg-static');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'POST only' });
  }

  const inputPath = join('/tmp', `input-${Date.now()}.m4a`);
  const outputPath = join('/tmp', `output-${Date.now()}.mp3`);

  try {
    const { sourceUrl, uploadUrl, supabaseKey } = req.body;

    if (!sourceUrl || !uploadUrl || !supabaseKey) {
      return res.status(400).json({
        success: false,
        error: 'Required fields: sourceUrl, uploadUrl, supabaseKey'
      });
    }

    // Step 1: Download the file from Supabase
    console.log('Downloading from: ' + sourceUrl);
    const downloadRes = await fetch(sourceUrl, {
      headers: {
        'Authorization': 'Bearer ' + supabaseKey
      }
    });
    if (!downloadRes.ok) {
      const errText = await downloadRes.text();
      throw new Error('Download failed: ' + downloadRes.status + ' ' + errText);
    }

    let audioBuffer = Buffer.from(await downloadRes.arrayBuffer());
    console.log('Downloaded: ' + audioBuffer.length + ' bytes');

    // Detect and handle different storage formats from n8n
    if (audioBuffer.length > 10) {
      const start = audioBuffer.slice(0, 30).toString('utf8');
      
      // Format 1: JSON Buffer from n8n {"type":"Buffer","data":[...]}
      if (start.startsWith('{"type":"Buffer"')) {
        console.log('Detected JSON Buffer format - reconstructing binary');
        const jsonData = JSON.parse(audioBuffer.toString('utf8'));
        audioBuffer = Buffer.from(jsonData.data);
        console.log('Reconstructed: ' + audioBuffer.length + ' bytes');
      }
      // Format 2: Base64 encoded string (starts with letters/numbers, no binary)
      else if (/^[A-Za-z0-9+/]/.test(start) && !start.includes('\x00')) {
        // Check if it looks like base64 (no null bytes, valid chars)
        const sample = audioBuffer.slice(0, 100).toString('utf8');
        if (/^[A-Za-z0-9+/=\s]+$/.test(sample)) {
          console.log('Detected base64 format - decoding');
          audioBuffer = Buffer.from(audioBuffer.toString('utf8'), 'base64');
          console.log('Decoded: ' + audioBuffer.length + ' bytes');
        }
      }
      // Format 3: Raw binary (starts with ftyp or similar) - use as-is
    }

    if (audioBuffer.length < 1000) {
      throw new Error('File too small after processing (' + audioBuffer.length + ' bytes)');
    }

    // Verify it looks like audio (check for ftyp header)
    const header = audioBuffer.slice(0, 12).toString('utf8');
    console.log('File header: ' + header.replace(/[^\x20-\x7E]/g, '.'));

    writeFileSync(inputPath, audioBuffer);

    // Step 2: Convert M4A to MP3
    console.log('Using ffmpeg at: ' + ffmpegPath);
    execFileSync(ffmpegPath, [
      '-i', inputPath,
      '-codec:a', 'libmp3lame',
      '-q:a', '2',
      '-y',
      outputPath
    ], {
      timeout: 25000,
      maxBuffer: 50 * 1024 * 1024
    });

    const mp3Buffer = readFileSync(outputPath);
    console.log('Converted MP3: ' + mp3Buffer.length + ' bytes');

    // Step 3: Upload MP3 back to Supabase
    console.log('Uploading to: ' + uploadUrl);
    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + supabaseKey,
        'Content-Type': 'audio/mpeg',
        'x-upsert': 'true'
      },
      body: mp3Buffer
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      throw new Error('Upload failed: ' + uploadRes.status + ' ' + errText);
    }

    try { unlinkSync(inputPath); } catch (e) {}
    try { unlinkSync(outputPath); } catch (e) {}

    return res.status(200).json({
      success: true,
      originalSize: audioBuffer.length,
      convertedSize: mp3Buffer.length
    });

  } catch (error) {
    console.error('Conversion error:', error.message);
    try { unlinkSync(inputPath); } catch (e) {}
    try { unlinkSync(outputPath); } catch (e) {}
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};
