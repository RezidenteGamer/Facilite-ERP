/* =============================================================
   Facilite — Tela de Login
   Validação de campos, estado do botão e mensagens de retorno.
   ============================================================= */
(function () {
  "use strict";

  var form     = document.getElementById("login-form");
  var feedback = document.getElementById("login-feedback");
  var submit   = form.querySelector(".btn--submit");
  var fields   = Array.prototype.slice.call(form.querySelectorAll(".field__input"));

  function clearError(input) {
    input.removeAttribute("aria-invalid");
    feedback.textContent = "";
  }

  function showError(input, message) {
    input.setAttribute("aria-invalid", "true");
    feedback.textContent = message;
    input.focus();
  }

  fields.forEach(function (input) {
    input.addEventListener("input", function () { clearError(input); });
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();

    var usuario = document.getElementById("usuario");
    var senha   = document.getElementById("senha");

    if (!usuario.value.trim()) {
      showError(usuario, "Informe o seu login para continuar.");
      return;
    }

    if (!senha.value) {
      showError(senha, "Informe a sua senha para continuar.");
      return;
    }

    clearError(usuario);
    clearError(senha);

    submit.dataset.loading = "true";
    submit.querySelector(".btn__label").textContent = "ENTRANDO...";

    // Ponto de integração: substituir pela chamada de autenticação do ERP.
    window.setTimeout(function () {
      delete submit.dataset.loading;
      submit.querySelector(".btn__label").textContent = "ENTRAR";
      feedback.textContent = "Autenticação ainda não conectada ao servidor.";
    }, 1100);
  });
})();
