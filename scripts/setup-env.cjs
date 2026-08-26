const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');

const ROOT_DIR = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT_DIR, '.env');
const ENV_EXAMPLE_PATH = path.join(ROOT_DIR, '.env.example');

function parseEnvTemplate(template) {
  const values = {};

  for (const line of template.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const value = trimmedLine.slice(separatorIndex + 1).trim();
    if (key) {
      values[key] = value;
    }
  }

  return values;
}

function createEnvFile(values) {
  const template = fs.readFileSync(ENV_EXAMPLE_PATH, 'utf8');
  const lines = template.split(/\r?\n/);

  const content = lines.map((line) => {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      return line;
    }

    const separatorIndex = trimmedLine.indexOf('=');
    if (separatorIndex === -1) {
      return line;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    return Object.prototype.hasOwnProperty.call(values, key) ? `${key}=${values[key]}` : line;
  }).join('\n');

  fs.writeFileSync(ENV_PATH, content, { encoding: 'utf8', mode: 0o600 });
}

async function askForSecrets(values) {
  const tokenKeys = Object.keys(values).filter((key) => /TOKEN|API_KEY|SECRET/i.test(key));
  if (tokenKeys.length === 0) {
    return values;
  }

  console.log('\nConfiguração inicial do GeradorClip');
  console.log('Os valores ficam somente no .env local, que não é versionado.');
  console.log(`Tokens reconhecidos pelo projeto: ${tokenKeys.join(', ')}.`);
  console.log('O backend aceita qualquer um dos tokens Hugging Face abaixo; vamos salvar no campo principal.');

  const readlineInterface = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const token = (await readlineInterface.question('Token Hugging Face/Pyannote (opcional, Enter para pular): ')).trim();
    if (token) {
      values.PYANNOTE_AUTH_TOKEN = token;
    }
  } finally {
    readlineInterface.close();
  }

  return values;
}

async function main() {
  if (fs.existsSync(ENV_PATH)) {
    return;
  }

  if (!fs.existsSync(ENV_EXAMPLE_PATH)) {
    throw new Error('Arquivo .env.example não encontrado.');
  }

  const values = parseEnvTemplate(fs.readFileSync(ENV_EXAMPLE_PATH, 'utf8'));
  const configuredValues = process.stdin.isTTY && process.stdout.isTTY
    ? await askForSecrets(values)
    : values;

  createEnvFile(configuredValues);
  console.log('Arquivo .env criado com sucesso.');
}

main().catch((error) => {
  console.error(`Não foi possível preparar o ambiente: ${error.message}`);
  process.exitCode = 1;
});
