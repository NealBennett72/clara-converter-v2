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

    // Step 1: Download the M4A from Supabase
    console.log('Downloading from: ' + sourceUrl);
    const downloadRes = await fetch(sourceUrl);
    if (!downloadRes.ok) {
      throw new Error('Download failed: ' + downloadRes.status);
    }
    const audioBuffer = Buffer.from(await downloadRes.arrayBuffer());
    console.log('Downloaded: ' + audioBuffer.length + ' bytes');

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
        'Content-Type': 'audio/mpeg'
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
