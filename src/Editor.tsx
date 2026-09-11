import React, { useEffect, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';

interface EditorProps {
    documentId: string;
}

export const Editor: React.FC<EditorProps> = ({documentId}) => {
    // Create CRDT document (state stable over renders)
    const [ydoc] = useState<Y.Doc>(() => new Y.Doc());
    const [isSynced, setIsSynced] = useState<boolean>(false);

    // Initialize local persistence via IndexedDB
    useEffect(() => {
        const indexeddbProvider = new IndexeddbPersistence(documentId, ydoc);

        // Event firing when document progress from db is loaded in ydoc
        indexeddbProvider.on('synced', () => {
            setIsSynced(true);
        });

        return () => {
            indexeddbProvider.destroy();
            ydoc.destroy();
        };
    }, [documentId, ydoc]);

    // Configure Tiptap with Yjs-collaboration extension
    const editor = useEditor({
        extensions: [
            // StarterKit with no history as Yjs brings undo/redo functionality
            StarterKit.configure({
               // undoInputRules: false,
            }),
            Collaboration.configure({
                document: ydoc,
                field: 'default-content', // Field name in the Yjs datastructure
            }),
        ],
    });

    return (
        <div style={{ maxWidth: '700px', margin: '2rem auto', fontFamily: 'sans-serif'}}>
        {/* Status bar */}
            <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span
                    style={{
                        display: 'inline-block',
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        backgroundColor: isSynced ? '#22c55e' : '#eab308',
                    }}
                />
                <small>
                    {isSynced ? 'IndexedDB synchronizing (offline ready)' : 'Loading from IndexedDB...  '}
                </small>
            </div>

            {/*Editor field*/}
            <div 
                style={{
                    border: '1px solid #ccc',
                    borderRadius: '8px',
                    padding: '1rem',
                    minHeight: '200px',
                }}
            >
                <EditorContent editor={editor} />
            </div>
        </div>
    );
};