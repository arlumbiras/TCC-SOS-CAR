// Máscaras simples para CPF e telefone
(function () {
  function apenasNumeros(s) {
    return (s || '').replace(/\D+/g, '');
  }

  function mascaraCPF(valor) {
    const v = apenasNumeros(valor).slice(0, 11);
    return v
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }

  function mascaraTelefone(valor) {
    const v = apenasNumeros(valor);
    // aceita 10 ou 11 dígitos (com ou sem 9)
    if (v.length <= 10) {
      // (00) 0000-0000
      return v
        .replace(/(\d{2})(\d)/, '($1) $2')
        .replace(/(\d{4})(\d)/, '$1-$2')
        .slice(0, 15);
    }
    // (00) 00000-0000
    return v
      .replace(/(\d{2})(\d)/, '($1) $2')
      .replace(/(\d{5})(\d)/, '$1-$2')
      .slice(0, 16);
  }

  function aplicarMascaraCPF(el) {
    // calcula quantos dígitos existem ANTES da posição atual do cursor
    const cursorNow = el.selectionStart || 0;
    const digitsBefore = apenasNumeros(el.value.slice(0, cursorNow)).length;
    const newFormatted = mascaraCPF(el.value);
    el.value = newFormatted;
    const newPos = indexForDigitCount(newFormatted, digitsBefore);
    try { el.setSelectionRange(newPos, newPos); } catch (e) {}
  }

  function aplicarMascaraTelefone(el) {
    const cursorNow = el.selectionStart || 0;
    const digitsBefore = apenasNumeros(el.value.slice(0, cursorNow)).length;
    const newFormatted = mascaraTelefone(el.value);
    el.value = newFormatted;
    const newPos = indexForDigitCount(newFormatted, digitsBefore);
    try { el.setSelectionRange(newPos, newPos); } catch (e) {}
  }

  // Retorna a posição (índice) no string formatado onde se encontra o
  // dígito número `count` (quantos dígitos ficam antes). Ex.: se
  // count=3 retorna índice logo após o 3º dígito.
  function indexForDigitCount(formatted, count) {
    if (count <= 0) return 0;
    let digits = 0;
    for (let i = 0; i < formatted.length; i++) {
      if (/\d/.test(formatted[i])) digits++;
      if (digits === count) return i + 1; // posição logo após este dígito
    }
    return formatted.length;
  }

  function ligarMascaras() {
    const cpfs = document.querySelectorAll('input[name="cpf"]');
    const phones = document.querySelectorAll('input[name="telefone"]');

    cpfs.forEach((el) => {
      el.addEventListener('input', (e) => aplicarMascaraCPF(el));
      el.addEventListener('blur', () => (el.value = mascaraCPF(el.value)));
    });

    phones.forEach((el) => {
      el.addEventListener('input', (e) => aplicarMascaraTelefone(el));
      el.addEventListener('blur', () => (el.value = mascaraTelefone(el.value)));
    });
  }

  // roda após DOM pronto
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ligarMascaras);
  else ligarMascaras();
})();
