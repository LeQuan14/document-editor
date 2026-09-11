import React, { useEffect, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { WebsocketProvider } from 'y-websocket';

interface EditorProps {
    documentId: string;
}

export const Editor: React.FC<EditorProps> = ({documentId}) => {
    // Create CRDT document (state stable over renders)
    const [ydoc] = useState<Y.Doc>(() => new Y.Doc());
    const [isLocalSynced, setIsLocalSynced] = useState<boolean>(false);
    const [isRemoteSynced, setIsRemoteSynced] = useState<boolean>(false);
    const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
    const websocketUrl = (import.meta as ImportMeta & {
        env?: {
            VITE_YJS_WS_URL?: string;
        };
    }).env?.VITE_YJS_WS_URL ?? 'ws://localhost:1234';

    // Initialize local persistence and remote sync providers
    useEffect(() => {
        const indexeddbProvider = new IndexeddbPersistence(documentId, ydoc);
        const websocketProvider = new WebsocketProvider(
            websocketUrl,
            documentId,
            ydoc,
        );

        // Event firing when document progress from db is loaded in ydoc
        indexeddbProvider.on('synced', () => {
            setIsLocalSynced(true);
        });

        websocketProvider.on('status', (event) => {
            setConnectionStatus(event.status);
        });

        websocketProvider.on('sync', (isSynced) => {
            setIsRemoteSynced(isSynced);
        });

        return () => {
            websocketProvider.destroy();
            indexeddbProvider.destroy();
            ydoc.destroy();
        };
    }, [documentId, websocketUrl, ydoc]);

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
                        backgroundColor: isLocalSynced && isRemoteSynced ? '#22c55e' : '#eab308',
                    }}
                />
                <small>
                    {isLocalSynced
                        ? isRemoteSynced
                            ? `Synced with ${connectionStatus === 'connected' ? 'server' : 'room'}`
                            : `Local ready, ${connectionStatus} to server`
                        : 'Loading from IndexedDB...'}
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