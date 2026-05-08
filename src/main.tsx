import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import { Theme } from '@radix-ui/themes';
import '@radix-ui/themes/styles.css';
import { GlobalStyle } from './lib/styles';
import { store } from './lib/store';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Provider store={store}>
      <BrowserRouter>
        <Theme appearance="dark" accentColor="sky" grayColor="slate">
          <GlobalStyle />
          <App />
        </Theme>
      </BrowserRouter>
    </Provider>
  </StrictMode>,
);
