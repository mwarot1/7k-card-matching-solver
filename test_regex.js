const text = '✅ Assigned 24/24 cards to types';
const pattern = /Assigned\s+(\d+)\/(\d+)\s+cards/;
const match = text.match(pattern);
console.log('Text:', text);
console.log('Pattern:', pattern);
console.log('Match:', match);
if (match) {
  console.log('Captured count:', match[1]);
  console.log('Total:', match[2]);
}
