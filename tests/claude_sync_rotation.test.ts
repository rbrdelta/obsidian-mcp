import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { extractSessionKey, saveRotatedKey } from '../src/importers/claude_api_sync';

let bad = 0;
const check = (name: string, ok: boolean) => { if (!ok) bad++; console.log(ok ? 'PASS' : 'FAIL', name); };

// Parsing Set-Cookie
check('no header -> null', extractSessionKey(undefined) === null);
check('other cookies only -> null', extractSessionKey(['cf_bm=abc; Path=/', 'lastActiveOrg=x']) === null);
check('finds sessionKey', extractSessionKey(['cf_bm=abc', 'sessionKey=sk-ant-sid01-NEW; Path=/; HttpOnly; Secure']) === 'sk-ant-sid01-NEW');
check('cleared cookie ignored', extractSessionKey(['sessionKey=; Max-Age=0; Path=/']) === null);
check('does not match prefixed name', extractSessionKey(['oldsessionKey=zzz']) === null);

// Writing the replacement key
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyrot-'));
const keyFile = path.join(dir, 'key');
fs.writeFileSync(keyFile, 'OLD\n');
process.env.CLAUDE_SESSION_KEY_FILE = keyFile;

saveRotatedKey('OLD', 'OLD');
check('same key -> file untouched', fs.readFileSync(keyFile, 'utf8') === 'OLD\n');
saveRotatedKey('NEW', 'OLD');
check('new key -> written', fs.readFileSync(keyFile, 'utf8') === 'NEW\n');
check('file mode 600', (fs.statSync(keyFile).mode & 0o777) === 0o600);
check('no tmp left behind', !fs.existsSync(keyFile + '.tmp'));

fs.rmSync(dir, { recursive: true });
process.exit(bad ? 1 : 0);
