import os, sys, json, time, threading, pathlib, re
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / '.artifacts' / 'pydeps'))
from winpty import PtyProcess
import pyte
root = pathlib.Path(__file__).resolve().parents[1]
mode = os.environ.get('CLAUDAPTER_TEST_MODE', 'native')
control = root / '.test-live' / ('tui-terminal' if mode == 'tui' else 'terminal')
control.mkdir(exist_ok=True)
env = os.environ.copy()
env['CLAUDE_CONFIG_DIR'] = os.environ.get('CLAUDAPTER_TEST_CLAUDE_HOME', str(root / '.test-live' / 'Claude Home'))
env['CLAUDAPTER_HOME'] = os.environ.get('CLAUDAPTER_TEST_ADAPTER_HOME', str(root / '.test-live' / 'Adapter Home'))
env['CLAUDAPTER_TRACE'] = '1'
cli = os.environ.get('CLAUDAPTER_TEST_CLI', str(root / 'dist' / 'cli.js'))
model = sys.argv[1] if len(sys.argv)>1 else 'gpt-6.1-sol'
args = ['node', cli] + (['tui'] if mode == 'tui' else []) + ['--', '--model', model, '--tools', 'Read,Edit,Bash,Agent,SendMessage,AskUserQuestion']
if os.environ.get('CLAUDAPTER_TEST_PERMISSION_MODE'):
    args += ['--permission-mode',os.environ['CLAUDAPTER_TEST_PERMISSION_MODE']]
proc = PtyProcess.spawn(args, cwd=os.environ.get('CLAUDAPTER_TEST_CWD',str(root / '.test-live' / 'demo project')), env=env, dimensions=(42,160))
def reader():
    screen=pyte.Screen(160,42)
    stream=pyte.Stream(screen)
    with (control/'output.log').open('w',encoding='utf8') as log:
        while proc.isalive():
            try:
                text=proc.read(65536)
                log.write(text); log.flush()
                stream.feed(text)
                (control/'screen.txt').write_text('\n'.join(line.rstrip() for line in screen.display),encoding='utf8')
                if '\x1b[6n' in text: proc.write('\x1b[1;1R')
            except EOFError: break
threading.Thread(target=reader,daemon=True).start()
print('PTY_RUNNING',flush=True)
deadline=time.monotonic()+3600
while proc.isalive() and time.monotonic()<deadline:
    for path in sorted(control.glob('command-*.json')):
        try:
            data=json.loads(path.read_text(encoding='utf-8-sig'))
        except (json.JSONDecodeError, PermissionError):
            continue
        proc.write(data['text']); path.unlink()
    time.sleep(.1)
if proc.isalive(): proc.terminate(force=True)
print('PTY_EXIT',proc.exitstatus,flush=True)
