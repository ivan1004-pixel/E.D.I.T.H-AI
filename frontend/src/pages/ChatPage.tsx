import React from 'react';
import { Chat } from '../components/Chat';

interface ChatPageProps {
  conversationId: string;
  conversationTitle?: string;
  onActivityChange?: () => void;
  onNewConversation?: () => void;
}

export const ChatPage: React.FC<ChatPageProps> = ({
  conversationId,
  conversationTitle,
  onActivityChange,
  onNewConversation,
}) => {
  return (
    <Chat
      conversationId={conversationId}
      conversationTitle={conversationTitle}
      onActivityChange={onActivityChange}
      onNewConversation={onNewConversation}
    />
  );
};
