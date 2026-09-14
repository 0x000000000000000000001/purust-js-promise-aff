module Test.PromiseAff.Native where

import Prelude

import Data.Time.Duration (Milliseconds(..))
import Effect (Effect)
import Effect.Aff (bracket, delay, forkAff, killFiber, launchAff_)
import Effect.Class (liftEffect)
import Effect.Console (log)
import Effect.Exception (error)
import Effect.Ref as Ref
import Promise as P
import Promise.Aff as PA
import Test.Assert as Assert
import Test.Main as Original

main :: Effect Unit
main = do
  Original.main
  launchAff_ do
    delayed <- liftEffect $ PA.fromAff do
      delay (Milliseconds 5.0)
      pure 42
    answer <- PA.toAff delayed
    liftEffect $ Assert.assertEqual { expected: 42, actual: answer }

    order <- liftEffect $ Ref.new 0
    observed <- liftEffect do
      result <- P.then_ (\_ -> Ref.read order <#> P.resolve) (P.resolve unit)
      Ref.write 7 order
      pure result
    afterTurn <- PA.toAff observed
    liftEffect $ Assert.assertEqual { expected: 7, actual: afterTurn }

    -- Canceling toAff detaches the Aff wait, not the underlying Promise work.
    finalized <- liftEffect $ Ref.new 0
    work <- liftEffect $ PA.fromAff $ bracket
      (pure unit)
      (\_ -> liftEffect $ Ref.modify_ (_ + 1) finalized)
      (\_ -> delay (Milliseconds 10.0) *> pure 123)
    waiting <- forkAff (PA.toAff work)
    killFiber (error "cancel wait") waiting
    eventual <- PA.toAff work
    count <- liftEffect $ Ref.read finalized
    liftEffect do
      Assert.assertEqual { expected: 123, actual: eventual }
      Assert.assertEqual { expected: 1, actual: count }
      log "Promise/Aff native bridge passed"
