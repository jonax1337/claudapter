import sys,pathlib,os
root=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'.artifacts'/'pydeps'))
import pyte
screen=pyte.Screen(160,42)
stream=pyte.Stream(screen)
folder='tui-terminal' if os.environ.get('CLAUDAPTER_TEST_MODE')=='tui' else 'terminal'
stream.feed((root/'.test-live'/folder/'output.log').read_bytes().decode('utf8'))
print('\n'.join(line.rstrip() for line in screen.display if line.strip()))
