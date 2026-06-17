// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title CheetahChain
 * @notice On-chain leaderboard for the "Swift Run — Celo Edition" endless runner.
 *         Every run a player finishes is recorded on Celo, so each game is a real
 *         on-chain transaction. The contract keeps:
 *           - a global, sorted top-10 leaderboard (one best entry per player)
 *           - per-player stats (best score, games played, last played)
 *           - global counters (total games, total unique players)
 */
contract CheetahChain {
    // ─── Types ────────────────────────────────────────────────────────────────

    struct Entry {
        address player;
        uint128 score;
        uint64  timestamp;
    }

    struct Player {
        uint128 bestScore;
        uint64  gamesPlayed;
        uint64  lastPlayed;
    }

    // ─── Storage ──────────────────────────────────────────────────────────────

    uint256 public constant MAX_TOP = 10;

    Entry[] private _top;                       // sorted high → low, length ≤ MAX_TOP
    mapping(address => Player) public players;   // per-player stats

    uint256 public totalGames;                  // every submitScore call
    uint256 public totalPlayers;                // unique addresses that have played

    // ─── Events ───────────────────────────────────────────────────────────────

    event ScoreSubmitted(address indexed player, uint256 score, bool personalBest);
    event NewLeaderboardEntry(address indexed player, uint256 score, uint256 rank);

    // ─── Write ────────────────────────────────────────────────────────────────

    /// @notice Record the score from a finished run. Call this on game over.
    function submitScore(uint256 score) external {
        require(score > 0, "score must be > 0");

        Player storage p = players[msg.sender];

        if (p.gamesPlayed == 0) {
            totalPlayers += 1;
        }
        p.gamesPlayed += 1;
        p.lastPlayed = uint64(block.timestamp);
        totalGames += 1;

        bool personalBest = score > p.bestScore;
        if (personalBest) {
            p.bestScore = uint128(score);
            _placeOnBoard(msg.sender, score);
        }

        emit ScoreSubmitted(msg.sender, score, personalBest);
    }

    /// @dev Insert a new personal best into the sorted top-10 (one entry per player).
    function _placeOnBoard(address player, uint256 score) internal {
        uint256 len = _top.length;

        // Remove this player's previous entry, if present.
        for (uint256 i = 0; i < len; i++) {
            if (_top[i].player == player) {
                for (uint256 j = i; j < len - 1; j++) {
                    _top[j] = _top[j + 1];
                }
                _top.pop();
                len--;
                break;
            }
        }

        // Board full and not better than the weakest entry → nothing to do.
        if (len == MAX_TOP && score <= _top[len - 1].score) {
            return;
        }

        // Find the rank: first position whose score this beats.
        uint256 pos = len;
        for (uint256 i = 0; i < len; i++) {
            if (score > _top[i].score) {
                pos = i;
                break;
            }
        }

        Entry memory e = Entry(player, uint128(score), uint64(block.timestamp));

        if (len < MAX_TOP) {
            _top.push(e); // grow by one, then shift into place
            for (uint256 i = _top.length - 1; i > pos; i--) {
                _top[i] = _top[i - 1];
            }
        } else {
            // Full board: shifting right drops the weakest (last) entry.
            for (uint256 i = len - 1; i > pos; i--) {
                _top[i] = _top[i - 1];
            }
        }
        _top[pos] = e;

        emit NewLeaderboardEntry(player, score, pos + 1);
    }

    // ─── Read ─────────────────────────────────────────────────────────────────

    /// @notice The full sorted leaderboard (high → low), up to MAX_TOP entries.
    function getTopScores() external view returns (Entry[] memory) {
        return _top;
    }

    /// @notice Number of entries currently on the leaderboard.
    function topCount() external view returns (uint256) {
        return _top.length;
    }

    /// @notice A player's best recorded score.
    function bestScoreOf(address player) external view returns (uint256) {
        return players[player].bestScore;
    }

    /// @notice Full stats for a player.
    function getPlayer(address player) external view returns (Player memory) {
        return players[player];
    }
}
