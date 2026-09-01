--!nonstrict
-- CameraController — the fixed single-screen viewport.
--
-- The defining property of the original arcade game: ONE static camera, the whole stadium
-- in frame, all eight trucks visible at every moment. No follow, no scroll, no zoom.
--
-- That constraint pays for itself technically. There is no streaming (`StreamingEnabled` is
-- false in default.project.json), no LOD, no culling decisions, and no per-frame camera
-- work. It also sidesteps a real Stellar Dominion failure: its far overhead camera showed
-- players ONLY floating health bars on mobile, because low graphics quality culls parts at
-- a few hundred studs while BillboardGuis always render. Roblox has no API to raise render
-- distance, so the only lever is camera distance — which is exactly what a stadium-sized
-- fixed camera keeps short.
--
-- Letterboxing is "modern" in the sense the spec asks for: the play area is masked to a
-- consistent aspect so that an ultrawide monitor confers no competitive advantage, and the
-- track is fitted to the MASKED region rather than to the raw viewport.
--
-- Both bars live in this controller's own ScreenGui and are sized in Scale, so there is no
-- cross-ScreenGui coordinate maths anywhere. Lessons F-03 and F-04 are avoided by
-- construction rather than handled carefully: `AbsolutePosition` is GuiInset-relative and
-- `ViewportSize` is physical, mixing them is wrong by one topbar inset, that error is
-- invisible in Studio, and the same-space fix still does not cancel a `UIScale`. The way to
-- win is not to play.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Workspace = game:GetService("Workspace")

local GameConfig = require(ReplicatedStorage.Shared.Config.GameConfig)
local LayoutConfig = require(ReplicatedStorage.Shared.Config.LayoutConfig)
local ClientState = require(script.Parent.Parent.ClientState)

local CameraController = {}

local camera = Workspace.CurrentCamera
local gui: ScreenGui? = nil
local topBar, bottomBar, leftBar, rightBar

local currentBounds = nil

--------------------------------------------------------------------------------

local function ensureGui()
	if gui then
		return
	end
	local playerGui = Players.LocalPlayer:WaitForChild("PlayerGui")

	gui = Instance.new("ScreenGui")
	gui.Name = "ViewportMask"
	gui.IgnoreGuiInset = true
	gui.ResetOnSpawn = false
	gui.DisplayOrder = 100
	gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
	gui.Parent = playerGui

	local function bar(name: string)
		local frame = Instance.new("Frame")
		frame.Name = name
		frame.BackgroundColor3 = LayoutConfig.Viewport.barColor
		frame.BackgroundTransparency = LayoutConfig.Viewport.barTransparency
		frame.BorderSizePixel = 0
		frame.Size = UDim2.fromScale(0, 0)
		frame.Parent = gui
		return frame
	end

	topBar, bottomBar = bar("Top"), bar("Bottom")
	leftBar, rightBar = bar("Left"), bar("Right")

	topBar.AnchorPoint = Vector2.new(0, 0)
	topBar.Position = UDim2.fromScale(0, 0)
	bottomBar.AnchorPoint = Vector2.new(0, 1)
	bottomBar.Position = UDim2.fromScale(0, 1)
	leftBar.AnchorPoint = Vector2.new(0, 0)
	leftBar.Position = UDim2.fromScale(0, 0)
	rightBar.AnchorPoint = Vector2.new(1, 0)
	rightBar.Position = UDim2.fromScale(1, 0)
end

--------------------------------------------------------------------------------

-- Recomputed only when the track changes or the viewport resizes. There is deliberately no
-- per-frame camera work at all.
local function fit()
	if not currentBounds then
		return
	end
	ensureGui()

	local viewport = camera.ViewportSize
	ClientState.viewport = viewport
	local viewAspect = viewport.X / math.max(viewport.Y, 1)

	local b = currentBounds
	local worldW = b.maxX - b.minX
	local worldD = b.maxZ - b.minZ

	local pitch = math.rad(GameConfig.Camera.PitchDegrees)

	-- Looking down at `pitch` above the horizon foreshortens the ground's depth axis by
	-- sin(pitch) in screen-vertical, while the width axis is unaffected. That single factor
	-- is the whole of the isometric fit.
	local screenH = worldD * math.sin(pitch)
	local screenW = worldW

	-- The play area is masked to a consistent aspect so an ultrawide monitor shows the same
	-- amount of track as a laptop, just with wider bars.
	local targetAspect = math.clamp(
		screenW / math.max(screenH, 1),
		LayoutConfig.Viewport.minAspect,
		LayoutConfig.Viewport.maxAspect
	)

	local barTop, barSide = 0, 0
	local visibleHeightFraction = 1

	if viewAspect > targetAspect then
		-- Viewport is wider than the play area: pillarbox.
		barSide = (1 - targetAspect / viewAspect) * 0.5
	else
		-- Viewport is taller: letterbox. This one also shrinks the vertical angle actually
		-- available to the track, which the distance calculation below must account for.
		visibleHeightFraction = viewAspect / targetAspect
		barTop = (1 - visibleHeightFraction) * 0.5
	end

	leftBar.Size = UDim2.fromScale(barSide, 1)
	rightBar.Size = UDim2.fromScale(barSide, 1)
	topBar.Size = UDim2.fromScale(1, barTop)
	bottomBar.Size = UDim2.fromScale(1, barTop)

	-- FieldOfView is vertical over the FULL viewport, so the masked region subtends a
	-- smaller angle.
	local halfV = math.rad(GameConfig.Camera.FieldOfView) * 0.5
	local effectiveHalfV = math.atan(math.tan(halfV) * visibleHeightFraction)
	local tanV = math.tan(effectiveHalfV)

	local margin = 1 + LayoutConfig.Viewport.fitMargin
	local distForHeight = (screenH * 0.5) / math.max(tanV, 1e-4)
	local distForWidth = (screenW * 0.5) / math.max(tanV * targetAspect, 1e-4)
	local distance = math.max(distForHeight, distForWidth) * margin

	local centre = Vector3.new((b.minX + b.maxX) * 0.5, b.minY or 0, (b.minZ + b.maxZ) * 0.5)
	local offset = Vector3.new(0, math.sin(pitch), math.cos(pitch)) * distance

	camera.CameraType = Enum.CameraType.Scriptable
	camera.FieldOfView = GameConfig.Camera.FieldOfView
	camera.CFrame = CFrame.lookAt(centre + offset, centre)
end

--------------------------------------------------------------------------------

function CameraController.frameTrack(track)
	currentBounds = track.bounds
	fit()
end

function CameraController.release()
	currentBounds = nil
	camera.CameraType = Enum.CameraType.Custom
	if gui then
		for _, bar in { topBar, bottomBar, leftBar, rightBar } do
			bar.Size = UDim2.fromScale(0, 0)
		end
	end
end

function CameraController.start()
	ensureGui()
	-- Refit on resize only. A player rotating a phone or dragging a window is the entire
	-- set of events this needs to react to.
	camera:GetPropertyChangedSignal("ViewportSize"):Connect(function()
		ClientState.viewport = camera.ViewportSize
		ClientState.ViewportChanged:fire(camera.ViewportSize)
		fit()
	end)
end

return CameraController
