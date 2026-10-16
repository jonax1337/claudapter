"""Render a real ConPTY ANSI capture for visual review; not a product dependency."""
import pathlib, sys, math
root = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / '.artifacts' / 'pydeps'))
import pyte
from PIL import Image, ImageDraw, ImageFont

source = pathlib.Path(sys.argv[1])
target = pathlib.Path(sys.argv[2])
screen = pyte.Screen(160, 42)
pyte.Stream(screen).feed(source.read_bytes().decode('utf8'))
font = ImageFont.truetype('C:/Windows/Fonts/consola.ttf', 16)
cell, line, margin = math.ceil(font.getlength('M')), 21, 20
palette = dict(black='#11131b', red='#f08a91', green='#88d39b', yellow='#e8cc81',
               blue='#78a9e8', magenta='#b49bea', cyan='#70c8da', white='#dddddd')
def color(value, default):
    if value == 'default': return default
    if len(value) == 6 and all(c in '0123456789abcdefABCDEF' for c in value): return '#' + value
    return palette.get(value.replace('bright',''), default)
picture = Image.new('RGB', (160*cell+margin*2, 42*line+margin*2), '#101119')
draw = ImageDraw.Draw(picture)
for y in range(42):
    for x in range(160):
        char = screen.buffer[y][x]
        fg, bg = color(char.fg, '#d8dae5'), color(char.bg, '#101119')
        if char.reverse: fg, bg = bg, fg
        left, top = margin+x*cell, margin+y*line
        if bg != '#101119': draw.rectangle((left,top,left+cell,top+line),fill=bg)
        draw.text((left,top),char.data,font=font,fill=fg)
picture.save(target)
print(target)
