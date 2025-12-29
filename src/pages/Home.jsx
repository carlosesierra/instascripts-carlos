// src/pages/Home.jsx
import { Link } from 'react-router-dom'

export default function Home() {
  return (
    <main className='home'>
      <h1>For Instant Scripts</h1>
      <p>Multiplayer Tic-Tac-Toe</p>
      <Link to='/game' className='button'>Start game</Link>
    </main>
  )
}
