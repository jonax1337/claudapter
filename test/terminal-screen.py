import sys,pathlib
root=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'.artifacts'/'pydeps'))
import pyte
screen=pyte.Screen(160,42)
stream=pyte.Stream(screen)
stream.feed((root/'.test-live'/'terminal'/'output.log').read_text(encoding='utf8'))
print('\n'.join(line.rstrip() for line in screen.display if line.strip()))
