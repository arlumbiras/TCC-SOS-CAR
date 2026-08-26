// =================================================================
// Alterna entre tema claro e escuro.
//
// A troca de cores em si é toda feita em CSS (ver style.css, variáveis
// dentro de :root[data-tema='escuro']) — este script só decide QUAL
// tema usar e escreve isso no atributo "data-tema" da tag <html>, que é
// o que o CSS usa para saber qual conjunto de cores aplicar.
// =================================================================
(function () {
  const CHAVE = 'sos-barbie-tema'; // nome usado para guardar a escolha no localStorage
  const botao = document.getElementById('btn-tema');
  const icone = botao.querySelector('.icone-tema');

  // Aplica um tema: atualiza o atributo em <html>, troca o ícone do
  // botão (lua = "clique para escurecer", sol = "clique para clarear")
  // e lembra a escolha para a próxima visita.
  function aplicar(tema) {
    document.documentElement.setAttribute('data-tema', tema);
    icone.textContent = tema === 'escuro' ? '☀️' : '🌙';
    localStorage.setItem(CHAVE, tema);
  }

  // Ao carregar a página: usa o tema que o usuário já escolheu antes
  // (se houver) ou, na primeira visita, respeita a preferência do
  // sistema operacional (prefers-color-scheme).
  const salvo = localStorage.getItem(CHAVE);
  const preferidoPeloSistema = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro';
  aplicar(salvo || preferidoPeloSistema);

  // Clique no botão: alterna entre os dois temas.
  botao.addEventListener('click', () => {
    const atual = document.documentElement.getAttribute('data-tema');
    aplicar(atual === 'escuro' ? 'claro' : 'escuro');
  });
})();
