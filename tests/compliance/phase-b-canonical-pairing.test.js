import test from 'node:test'
import { cases, inputFor, verifyCase } from '../fixtures/phase-b-sequences.js'

for (const c of cases) test(c[0], () => verifyCase(c,inputFor(c)))
