import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import EggsBg from './assets/Eggs Reduced.jpg';

const img = new Image();
img.src = EggsBg;
img.onload = () => {
  document.body.style.backgroundImage = `url(${EggsBg})`;
};
document.body.style.backgroundRepeat = 'no-repeat';
document.body.style.backgroundPosition = 'center center';
document.body.style.backgroundAttachment = 'fixed';
document.body.style.backgroundSize = '100% 100%';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
