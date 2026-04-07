// stateManager.js
const { Octokit } = require("@octokit/rest");

// Autenticação com o token que está nos segredos do GitHub
const octokit = new Octokit({ auth: process.env.GIST_TOKEN });
const GIST_ID = process.env.GIST_ID;

async function carregarEstado() {
  try {
    const gist = await octokit.gists.get({ gist_id: GIST_ID });
    const arquivo = gist.data.files['bot_state.json'];
    return arquivo ? JSON.parse(arquivo.content) : { contador: 0 };
  } catch (erro) {
    console.error("Erro ao carregar estado. Iniciando do zero.");
    return { contador: 0 };
  }
}

async function salvarEstado(estado) {
  await octokit.gists.update({
    gist_id: GIST_ID,
    files: { 'bot_state.json': { content: JSON.stringify(estado) } }
  });
}

module.exports = { carregarEstado, salvarEstado };
