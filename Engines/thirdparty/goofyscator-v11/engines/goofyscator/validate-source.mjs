import fs from 'node:fs';
import {validateRecoveredSource} from './deobfuscate.mjs';
import {validateGeneratedBindings,measureReadability} from './readability.mjs';
import {validateStartupCalls} from './semantic-validation.mjs';
const code=fs.readFileSync(process.argv[2],'utf8');
validateGeneratedBindings(code);const startup=validateStartupCalls(code);validateRecoveredSource(code);
console.log(JSON.stringify({syntax_checked:true,compile_checked:true,startup,metrics:measureReadability(code)}));
