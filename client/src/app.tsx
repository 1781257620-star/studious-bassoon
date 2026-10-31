import React, { useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';

import Layout from './components/Layout';
import ShelfPage from './pages/Shelf/ShelfPage';
import ReadPage from './pages/Read/ReadPage';
import ProcessPage from './pages/Process/ProcessPage';
import SettingsPage from './pages/Settings/SettingsPage';
import NotFound from './pages/NotFound/NotFound';
import { runAppInit } from '@client/src/services/app-init';
import { registerServiceWorker } from '@client/src/services/pwa';

runAppInit();

const RoutesComponent = () => {
  useEffect(() => {
    registerServiceWorker();
  }, []);

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<ShelfPage />} />
        <Route path="read" element={<ReadPage />} />
        <Route path="process" element={<ProcessPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

export default RoutesComponent;
