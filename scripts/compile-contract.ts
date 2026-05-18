import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import solc from 'solc'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const contractPath = resolve(root, 'contracts', 'BondMirrorBond.sol')
const source = readFileSync(contractPath, 'utf8')

const input = {
  language: 'Solidity',
  sources: {
    'BondMirrorBond.sol': {
      content: source,
    },
  },
  settings: {
    optimizer: {
      enabled: true,
      runs: 200,
    },
    outputSelection: {
      '*': {
        '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'],
      },
    },
  },
}

const output = JSON.parse(solc.compile(JSON.stringify(input)))
const errors = (output.errors ?? []) as Array<{ severity: string; formattedMessage: string }>
for (const error of errors) {
  if (error.severity === 'error') {
    throw new Error(error.formattedMessage)
  }
  console.warn(error.formattedMessage)
}

const compiled = output.contracts['BondMirrorBond.sol'].BondMirrorBond
const artifact = {
  contractName: 'BondMirrorBond',
  abi: compiled.abi,
  bytecode: `0x${compiled.evm.bytecode.object}`,
  deployedBytecode: `0x${compiled.evm.deployedBytecode.object}`,
}

const artifactsDir = resolve(root, 'artifacts')
mkdirSync(artifactsDir, { recursive: true })
writeFileSync(resolve(artifactsDir, 'BondMirrorBond.json'), `${JSON.stringify(artifact, null, 2)}\n`)

console.log(`Compiled BondMirrorBond -> ${resolve(artifactsDir, 'BondMirrorBond.json')}`)
