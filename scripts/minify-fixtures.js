const fs = require('fs');
const path = require('path');

function minifyHtml(inputPath, outputPath) {
  let html = fs.readFileSync(inputPath, 'utf-8');
  const originalSize = Buffer.byteLength(html, 'utf-8');

  // Remove comments
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  
  // Remove script content (keep script tags but empty them)
  html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '<script></script>');
  
  // Remove style content
  html = html.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '<style></style>');
  
  // Remove noscript tags
  html = html.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
  
  // Remove unnecessary attributes from various elements (data-*, onclick handlers, etc)
  html = html.replace(/\s(data-[a-z-]*|onclick|onload|onerror)="[^"]*"/gi, '');
  html = html.replace(/\s(data-[a-z-]*|onclick|onload|onerror)='[^']*'/gi, '');
  
  // Remove image src and srcset attributes  
  html = html.replace(/\ssrc="[^"]*"/gi, '');
  html = html.replace(/\ssrcset="[^"]*"/gi, '');
  
  // Remove unnecessary meta tags and link tags
  html = html.replace(/<meta\s+(name|property)=("twitter:|"og:|"pinterest:|"article:)[^>]*>/gi, '');
  html = html.replace(/<link\s+rel="(apple-touch-icon|shortcut|icon|canonical|preconnect|prefetch|preload|dns-prefetch)"[^>]*>/gi, '');
  
  // Remove style attributes that are very long (inline styles)
  html = html.replace(/\sstyle="[^"]{100,}"/gi, '');
  
  // Remove most class attributes (keep only essential ones)
  html = html.replace(/\sclass="[^"]{50,}"/gi, '');
  
  // Collapse whitespace
  html = html.replace(/\n\s*/g, '');
  html = html.replace(/>\s+</g, '><');
  html = html.replace(/\s\s+/g, ' ');

  fs.writeFileSync(outputPath, html, 'utf-8');
  
  const minifiedSize = Buffer.byteLength(html, 'utf-8');
  const percent = ((1 - minifiedSize / originalSize) * 100).toFixed(1);
  console.log(`${path.basename(inputPath)}: ${originalSize} -> ${minifiedSize} bytes (${percent}% reduction)`);
}

const fixturePath = path.join(__dirname, '..', 'tests', 'fixtures', 'coupons');
minifyHtml(path.join(fixturePath, 'coupon-01-product.html'), path.join(fixturePath, 'coupon-01-product.html'));
minifyHtml(path.join(fixturePath, 'coupon-02-product.html'), path.join(fixturePath, 'coupon-02-product.html'));
