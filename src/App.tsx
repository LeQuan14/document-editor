import React from 'react';
import { Editor } from './Editor';

export default function App() {
    return (
        <main>
            <h1 style={{ textAlign: 'center' }}>Local-first Editor</h1>
            {/* Every document needs a unique identifier */}
            <Editor documentId="my-document" />
        </main>
    );
}