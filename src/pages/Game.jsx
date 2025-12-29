import { useEffect, useMemo, useState } from 'react'
import { socket } from '../services/socket'

const emptyBoard = Array(9).fill(null)
const initialState = {
  board: emptyBoard,
  turn: 'X',
  players: { X: null, O: null },
  winner: null,
  isDraw: false,
  mode: 'pvp',
  difficulty: 'easy'
}

const buildRoomId = (mode) =>
  `${mode}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

export default function Game() {
  const [status, setStatus] = useState('offline')
  const [game, setGame] = useState(initialState)
  const [mySymbol, setMySymbol] = useState(null)
  const [name, setName] = useState('')
  const [roomId, setRoomId] = useState('lobby')
  const [joinedRoomId, setJoinedRoomId] = useState('')
  const [fullRoomId, setFullRoomId] = useState('')
  const [mode, setMode] = useState('pvp')
  const [difficulty, setDifficulty] = useState('easy')
  const [playAs, setPlayAs] = useState('X')
  const [error, setError] = useState('')

  useEffect(() => {
    const handleConnect = () => setStatus('online')
    const handleDisconnect = () => setStatus('offline')
    const handleState = (nextState) => setGame(nextState)
    const handleError = (payload) => {
      const message = payload && payload.message ? payload.message : 'Unknown error'
      setError(message)
    }

    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)
    socket.on('game:state', handleState)
    socket.on('game:error', handleError)

    return () => {
      socket.off('connect', handleConnect)
      socket.off('disconnect', handleDisconnect)
      socket.off('game:state', handleState)
      socket.off('game:error', handleError)
    }
  }, [])

  useEffect(() => {
    setRoomId(buildRoomId(mode))
    setError('')
    setFullRoomId('')
  }, [mode])

  const winner = game.winner
  const isDraw = game.isDraw
  const nameValid = name.trim().length > 0
  const winnerName = winner && game.players && game.players[winner] ? game.players[winner].name : winner
  const turnText = winner
    ? `Winner: ${winnerName}`
    : isDraw
      ? 'Draw'
      : `Next: ${game.turn}`
  const turnClass = winner ? 'turn-text shake' : 'turn-text'

  const canPlay = Boolean(mySymbol) && !winner && !isDraw && game.turn === mySymbol
  const players = game.players || {}
  const bothPlayers = Boolean(players.X) && Boolean(players.O)
  const isKnownFull = roomId === fullRoomId && fullRoomId.length > 0
  const isJoinedRoomFull = roomId === joinedRoomId && joinedRoomId.length > 0 && bothPlayers && game.mode === mode
  const roomIsFull = isKnownFull || isJoinedRoomFull

  const emitJoin = (nextRoomId) => {
    const cleanName = name.trim()
    const cleanRoom = (nextRoomId || roomId).trim() || 'lobby'

    if (!cleanName) {
      setError('Name is required.')
      return
    }

    setRoomId(cleanRoom)
    setError('')
    setMySymbol(null)
    setFullRoomId('')

    socket.emit(
      'game:join',
      {
        roomId: cleanRoom,
        name: cleanName,
        mode,
        difficulty,
        symbol: playAs
      },
      (response) => {
        if (response && response.error) {
          setError(response.error)
          if (response.error === 'Room is full.') {
            setFullRoomId(cleanRoom)
          }
          return
        }
        if (response && response.symbol) {
          setMySymbol(response.symbol)
          setJoinedRoomId(cleanRoom)
          setFullRoomId('')
        }
      }
    )
  }

  const handleJoin = (event) => {
    event.preventDefault()
    emitJoin()
  }

  const handleForceNewRoom = () => {
    emitJoin(buildRoomId(mode))
  }

  const handleCellClick = (index) => {
    if (!mySymbol) {
      setError('Join a room to play.')
      return
    }
    socket.emit('game:move', { roomId, index })
  }

  const handleReset = () => {
    if (!mySymbol) {
      setError('Join a room to reset.')
      return
    }
    socket.emit('game:reset', { roomId })
  }

  const playerX = game.players && game.players.X ? game.players.X.name : 'Waiting...'
  const playerO = game.players && game.players.O ? game.players.O.name : 'Waiting...'
  const board = useMemo(() => game.board || emptyBoard, [game.board])

  return (
    <main className='page'>
      <section className='game-shell'>
        <header className='game-header'>
          <div>
            <p className='eyebrow'>For Instant Scripts</p>
            <h1>Tic-Tac-Toe</h1>
          </div>
          <div className='status'>
            <span className={`status-dot ${status === 'online' ? 'on' : ''}`} />
            <span>{status}</span>
          </div>
        </header>

        <form className='lobby' onSubmit={handleJoin}>
          <div className='field'>
            <label htmlFor='player-name'>Name</label>
            <input
              id='player-name'
              type='text'
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder='Player name'
              required
            />
          </div>
          <div className='field'>
            <label htmlFor='room-id'>Room</label>
            <input
              id='room-id'
              type='text'
              value={roomId}
              onChange={(event) => setRoomId(event.target.value)}
              placeholder='lobby'
            />
          </div>
          <div className='field'>
            <label htmlFor='mode'>Mode</label>
            <select id='mode' value={mode} onChange={(event) => setMode(event.target.value)}>
              <option value='pvp'>Player vs Player</option>
              <option value='bot'>Play vs Computer</option>
            </select>
          </div>
          {mode === 'bot' ? (
            <div className='field'>
              <label htmlFor='difficulty'>Difficulty</label>
              <select
                id='difficulty'
                value={difficulty}
                onChange={(event) => setDifficulty(event.target.value)}
              >
                <option value='easy'>Easy</option>
                <option value='hard'>Hard</option>
              </select>
            </div>
          ) : null}
          {mode === 'bot' ? (
            <div className='field'>
              <label htmlFor='play-as'>Play as</label>
              <select id='play-as' value={playAs} onChange={(event) => setPlayAs(event.target.value)}>
                <option value='X'>X (go first)</option>
                <option value='O'>O (go second)</option>
              </select>
            </div>
          ) : null}
          <button className='button primary' type='submit' disabled={!nameValid || roomIsFull}>
            Join
          </button>
          <button className='button secondary' type='button' onClick={handleForceNewRoom} disabled={!nameValid}>
            Force new room
          </button>
        </form>

        {error ? <div className='error'>{error}</div> : null}

        <div className='players'>
          <div className='player'>
            <span className='badge'>X</span>
            <span>{playerX}</span>
          </div>
          <div className='player'>
            <span className='badge'>O</span>
            <span>{playerO}</span>
          </div>
          <div className='player'>
            <span className='badge'>You</span>
            <span>{mySymbol || '-'}</span>
          </div>
        </div>

        <div className='board' role='grid' aria-label='tic tac toe board'>
          {board.map((value, index) => (
            <button
              key={index}
              className='cell'
              type='button'
              onClick={() => handleCellClick(index)}
              disabled={!canPlay || Boolean(value)}
              aria-label={`Cell ${index + 1}`}
            >
              {value}
            </button>
          ))}
        </div>

        <div className='controls'>
          <div className='turn'>
            <span key={winner ? `winner-${winnerName}` : 'turn'} className={turnClass}>
              {turnText}
            </span>
          </div>
          <button className='button' type='button' onClick={handleReset}>
            Reset
          </button>
        </div>
      </section>
    </main>
  )
}
