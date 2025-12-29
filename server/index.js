const express = require('express')
const http = require('http')
const { Server } = require('socket.io')

const app = express()
const server = http.createServer(app)
const io = new Server(server, {
  cors: { origin: 'http://localhost:5173' }
})

const rooms = new Map()
const winLines = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6]
]

const emptyBoard = () => Array(9).fill(null)

const normalizeMode = (value) => (value === 'bot' ? 'bot' : 'pvp')
const normalizeDifficulty = (value) => (value === 'hard' ? 'hard' : 'easy')
const normalizeSymbol = (value) => (value === 'O' ? 'O' : 'X')

const getWinner = (board) => {
  for (const [a, b, c] of winLines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a]
    }
  }
  return null
}

const getAvailableMoves = (board) =>
  board.map((value, index) => (value ? null : index)).filter((value) => value !== null)

const resetRoom = (room) => {
  room.board = emptyBoard()
  room.turn = 'X'
  room.winner = null
  room.isDraw = false
}

const createRoom = (roomId) => ({
  id: roomId,
  board: emptyBoard(),
  turn: 'X',
  players: { X: null, O: null },
  sockets: new Map(),
  winner: null,
  isDraw: false,
  mode: 'pvp',
  difficulty: 'easy',
  botSymbol: null
})

const getRoom = (roomId) => {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, createRoom(roomId))
  }
  return rooms.get(roomId)
}

const isBot = (player) => player && player.id === 'BOT'

const hasHuman = (room) => {
  const xHuman = room.players.X && !isBot(room.players.X)
  const oHuman = room.players.O && !isBot(room.players.O)
  return Boolean(xHuman || oHuman)
}

const ensureBot = (room, botSymbol, difficulty) => {
  room.mode = 'bot'
  room.botSymbol = botSymbol
  room.difficulty = normalizeDifficulty(difficulty)
  room.players.X = null
  room.players.O = null
  room.players[botSymbol] = {
    id: 'BOT',
    name: `Computer (${room.difficulty})`,
    isBot: true
  }
}

const ensurePvp = (room) => {
  room.mode = 'pvp'
  room.botSymbol = null
  room.difficulty = 'easy'
  if (isBot(room.players.X)) {
    room.players.X = null
  }
  if (isBot(room.players.O)) {
    room.players.O = null
  }
}

const getState = (room) => ({
  board: room.board,
  turn: room.turn,
  players: room.players,
  winner: room.winner,
  isDraw: room.isDraw,
  mode: room.mode,
  difficulty: room.difficulty
})

const emitState = (roomId) => {
  const room = rooms.get(roomId)
  if (room) {
    io.to(roomId).emit('game:state', getState(room))
  }
}

const applyMove = (room, symbol, index) => {
  room.board[index] = symbol
  room.winner = getWinner(room.board)
  room.isDraw = !room.winner && room.board.every(Boolean)
  if (!room.winner && !room.isDraw) {
    room.turn = room.turn === 'X' ? 'O' : 'X'
  }
}

const minimax = (board, current, botSymbol, humanSymbol, depth = 0) => {
  const winner = getWinner(board)
  if (winner === botSymbol) {
    return { score: 10 - depth }
  }
  if (winner === humanSymbol) {
    return { score: depth - 10 }
  }
  if (board.every(Boolean)) {
    return { score: 0 }
  }

  const moves = []
  for (const index of getAvailableMoves(board)) {
    board[index] = current
    const result = minimax(
      board,
      current === botSymbol ? humanSymbol : botSymbol,
      botSymbol,
      humanSymbol,
      depth + 1
    )
    moves.push({ index, score: result.score })
    board[index] = null
  }

  if (current === botSymbol) {
    return moves.reduce((best, move) => (move.score > best.score ? move : best))
  }
  return moves.reduce((best, move) => (move.score < best.score ? move : best))
}

const getBotMove = (room) => {
  const moves = getAvailableMoves(room.board)
  if (!moves.length) {
    return null
  }

  if (room.difficulty === 'easy') {
    return moves[Math.floor(Math.random() * moves.length)]
  }

  const botSymbol = room.botSymbol
  const humanSymbol = botSymbol === 'X' ? 'O' : 'X'
  return minimax(room.board, botSymbol, botSymbol, humanSymbol).index
}

const maybeBotMove = (room, roomId) => {
  if (room.mode !== 'bot' || room.botSymbol !== room.turn) {
    return false
  }

  if (room.winner || room.isDraw) {
    return false
  }

  const botIndex = getBotMove(room)
  if (botIndex === null) {
    return false
  }

  applyMove(room, room.botSymbol, botIndex)
  emitState(roomId)
  return true
}

const sanitize = (value, fallback) => {
  if (typeof value !== 'string') {
    return fallback
  }
  const next = value.trim()
  return next.length ? next : fallback
}

io.on('connection', (socket) => {
  console.log('connected', socket.id)

  socket.on('ping', () => {
    socket.emit('pong')
  })

  socket.on('game:join', (payload = {}, ack) => {
    const roomId = sanitize(payload.roomId, 'lobby')
    const name = sanitize(payload.name, '')
    const mode = normalizeMode(payload.mode)
    const difficulty = normalizeDifficulty(payload.difficulty)
    const preferredSymbol = normalizeSymbol(payload.symbol)

    if (!name) {
      socket.emit('game:error', { message: 'Name is required.' })
      if (typeof ack === 'function') {
        ack({ error: 'Name is required.' })
      }
      return
    }

    const room = getRoom(roomId)
    const humanPresent = hasHuman(room)

    if (!humanPresent) {
      resetRoom(room)
      if (mode === 'bot') {
        const botSymbol = preferredSymbol === 'X' ? 'O' : 'X'
        ensureBot(room, botSymbol, difficulty)
      } else {
        ensurePvp(room)
      }
    } else if (room.mode !== mode) {
      socket.emit('game:error', { message: 'Room mode does not match.' })
      if (typeof ack === 'function') {
        ack({ error: 'Room mode does not match.' })
      }
      return
    }

    if (mode === 'bot') {
      if (humanPresent) {
        socket.emit('game:error', { message: 'Room is full.' })
        if (typeof ack === 'function') {
          ack({ error: 'Room is full.' })
        }
        return
      }

      socket.join(roomId)
      socket.data.roomId = roomId
      socket.data.symbol = preferredSymbol
      socket.data.name = name

      room.players[preferredSymbol] = { id: socket.id, name }
      room.sockets.set(socket.id, preferredSymbol)

      if (typeof ack === 'function') {
        ack({ roomId, symbol: preferredSymbol, mode, difficulty: room.difficulty })
      }

      emitState(roomId)
      maybeBotMove(room, roomId)
      return
    }

    let symbol = null
    if (!room.players.X) {
      symbol = 'X'
    } else if (!room.players.O) {
      symbol = 'O'
    }

    if (!symbol) {
      socket.emit('game:error', { message: 'Room is full.' })
      if (typeof ack === 'function') {
        ack({ error: 'Room is full.' })
      }
      return
    }

    socket.join(roomId)
    socket.data.roomId = roomId
    socket.data.symbol = symbol
    socket.data.name = name

    room.players[symbol] = { id: socket.id, name }
    room.sockets.set(socket.id, symbol)

    if (typeof ack === 'function') {
      ack({ roomId, symbol, mode, difficulty: room.difficulty })
    }

    emitState(roomId)
  })

  socket.on('game:move', (payload = {}) => {
    const roomId = sanitize(payload.roomId, socket.data.roomId)
    const index = payload.index

    const room = rooms.get(roomId)
    const symbol = socket.data.symbol

    if (!room || !symbol) {
      socket.emit('game:error', { message: 'Join a room first.' })
      return
    }

    if (room.turn !== symbol) {
      socket.emit('game:error', { message: 'Not your turn.' })
      return
    }

    if (room.winner || room.isDraw) {
      socket.emit('game:error', { message: 'Game is finished.' })
      return
    }

    if (typeof index !== 'number' || index < 0 || index > 8) {
      socket.emit('game:error', { message: 'Invalid move.' })
      return
    }

    if (room.board[index]) {
      socket.emit('game:error', { message: 'Cell already taken.' })
      return
    }

    applyMove(room, symbol, index)

    if (room.mode === 'bot') {
      maybeBotMove(room, roomId)
    }

    emitState(roomId)
  })

  socket.on('game:reset', (payload = {}) => {
    const roomId = sanitize(payload.roomId, socket.data.roomId)
    const room = rooms.get(roomId)

    if (!room || !socket.data.symbol) {
      socket.emit('game:error', { message: 'Join a room first.' })
      return
    }

    resetRoom(room)
    emitState(roomId)
    maybeBotMove(room, roomId)
  })

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId
    const room = rooms.get(roomId)

    if (!room) {
      return
    }

    const symbol = room.sockets.get(socket.id)
    if (symbol) {
      if (room.players[symbol] && !isBot(room.players[symbol])) {
        room.players[symbol] = null
      }
      room.sockets.delete(socket.id)
    }

    if (!hasHuman(room)) {
      resetRoom(room)
    }

    emitState(roomId)
  })
})

const PORT = process.env.PORT || 3001
server.listen(PORT, () => {
  console.log(`server listening on ${PORT}`)
})
