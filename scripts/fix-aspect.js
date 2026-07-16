const fs = require('fs');
const files = [
  'app/(tabs)/movies/page.tsx',
  'app/(tabs)/explore/page.tsx'
];
files.forEach(f => {
  let c = fs.readFileSync(f, 'utf8');
  c = c.replace(/aspect-\[2:3\] bg-secondary/g, 'bg-secondary');
  c = c.replace(/<div className="bg-secondary"/g, '<div style={{aspectRatio:"2 / 3"}} className="bg-secondary"');
  fs.writeFileSync(f, c);
  console.log('Fixed: ' + f);
});
