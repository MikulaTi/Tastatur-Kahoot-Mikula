import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';
import { firebaseConfig } from './firebase-config.js';
export const SETUP_OK = !firebaseConfig.apiKey.startsWith('DEIN');
export const db = SETUP_OK ? getDatabase(initializeApp(firebaseConfig)) : null;
