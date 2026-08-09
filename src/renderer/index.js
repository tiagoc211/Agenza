import './styles.css';

const environment = document.querySelector('#environment');

if (environment) {
  environment.textContent = `Running on ${window.agenza.platform}`;
}
