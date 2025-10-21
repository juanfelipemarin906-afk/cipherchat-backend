const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Configuración CORS - ACEPTA TU DOMINIO DE VERCEL
const corsOptions = {
  origin: [
    'http://localhost:3000',           // Desarrollo local
    'http://127.0.0.1:5500',           // Live Server
    'https://cipherchat-frontend.vercel.app',   // TU DOMINIO DE VERCEL (cámbialo después)
    // Agrega tu dominio real de Vercel aquí después del despliegue
  ],
  credentials: true,
  methods: ['GET', 'POST']
};

app.use(cors(corsOptions));
app.use(express.json());

// Ruta de salud para verificar que el servidor funciona
app.get('/', (req, res) => {
  res.json({ 
    status: 'CipherChat WebSocket Server Running',
    timestamp: new Date().toISOString()
  });
});

// Configuración de Socket.IO
const io = socketIo(server, {
  cors: corsOptions,
  transports: ['websocket'], // Solo WebSocket, más seguro
  allowEIO3: false
});

// Almacenamiento en memoria (en producción usar Redis)
const activeChats = new Map(); // Mapa: inviteId -> { participants: Set, messages: Array }

// Eventos de WebSocket
io.on('connection', (socket) => {
  console.log('✅ Nuevo cliente conectado:', socket.id);

  // Manejar unión a chat
  socket.on('join-chat', (data) => {
    const { inviteId, alias } = data;
    
    if (!inviteId || !alias) {
      socket.emit('error', { message: 'Datos de invitación inválidos' });
      return;
    }

    // Unir socket a la sala del chat
    socket.join(inviteId);
    
    // Inicializar chat si no existe
    if (!activeChats.has(inviteId)) {
      activeChats.set(inviteId, {
        participants: new Set(),
        messages: [],
        createdAt: new Date()
      });
    }
    
    const chat = activeChats.get(inviteId);
    chat.participants.add(alias);
    
    console.log(`👤 ${alias} se unió al chat ${inviteId}`);
    
    // Notificar a otros participantes
    socket.to(inviteId).emit('user-joined', { 
      alias, 
      message: `${alias} se ha unido al chat seguro` 
    });
    
    // Confirmar unión al nuevo usuario
    socket.emit('joined-chat', { 
      success: true, 
      inviteId,
      message: 'Conexión segura establecida' 
    });
  });

  // Manejar mensajes
  socket.on('message', (data) => {
    const { inviteId, message, sender } = data;
    
    if (!inviteId || !message || !sender) {
      socket.emit('error', { message: 'Mensaje inválido' });
      return;
    }

    console.log(`📨 Mensaje en chat ${inviteId}: ${message}`);
    
    // Guardar mensaje en el servidor (opcional, para historial)
    if (activeChats.has(inviteId)) {
      const chat = activeChats.get(inviteId);
      chat.messages.push({
        message,
        sender,
        timestamp: Date.now(),
        id: Math.random().toString(36).substring(2, 15)
      });
      
      // Mantener solo últimos 100 mensajes
      if (chat.messages.length > 100) {
        chat.messages.shift();
      }
    }
    
    // Reenviar mensaje a todos en la sala (excepto emisor)
    socket.to(inviteId).emit('message', { message, sender });
  });

  // Manejar auto-borrado bilateral
  socket.on('auto-delete-request', (data) => {
    const { inviteId } = data;
    
    console.log(`🗑️ Solicitud de auto-borrado para chat: ${inviteId}`);
    
    // Notificar a todos los participantes del chat
    io.to(inviteId).emit('auto-delete-trigger', { 
      inviteId,
      message: 'Chat eliminado por seguridad' 
    });
    
    // Limpiar datos del chat del servidor
    setTimeout(() => {
      if (activeChats.has(inviteId)) {
        activeChats.delete(inviteId);
        console.log(`🧹 Chat ${inviteId} limpiado del servidor`);
      }
    }, 1000);
  });

  // Manejar desconexión
  socket.on('disconnect', () => {
    console.log(`🔌 Cliente desconectado: ${socket.id}`);
    
    // Aquí podrías limpiar sockets, pero como usamos alias, 
    // la limpieza se hace en auto-delete o por inactividad
  });

  // Manejar errores
  socket.on('error', (error) => {
    console.error('❌ Error en socket:', error);
  });
});

// Limpieza periódica de chats inactivos (cada 30 minutos)
setInterval(() => {
  const now = Date.now();
  const inactiveChats = [];
  
  for (const [inviteId, chat] of activeChats.entries()) {
    const lastMessage = chat.messages.length > 0 
      ? chat.messages[chat.messages.length - 1].timestamp 
      : chat.createdAt.getTime();
    
    // Limpiar chats inactivos por más de 2 horas
    if (now - lastMessage > 2 * 60 * 60 * 1000) {
      inactiveChats.push(inviteId);
    }
  }
  
  inactiveChats.forEach(inviteId => {
    activeChats.delete(inviteId);
    console.log(`🧹 Chat inactivo limpiado: ${inviteId}`);
  });
}, 30 * 60 * 1000);

// Iniciar servidor
const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 CipherChat WebSocket Server corriendo en puerto ${PORT}`);
  console.log(`📡 Process PID: ${process.pid}`);
  console.log(`🌐 Hostname: ${require('os').hostname()}`);
});