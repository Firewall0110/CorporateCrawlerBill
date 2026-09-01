--!nonstrict
-- TruckBuilder — the voxel truck, and the one function that moves it.
--
-- A truck is nine flat-coloured parts welded to a root. It is a VIEW: it holds no state and
-- decides nothing. `TruckBuilder.apply` copies a `VehicleSim` vehicle's position, heading and
-- suspension onto the model, and that is the only way a truck ever moves.
--
-- Everything is Anchored and moved with `PivotTo`. There is no `BodyVelocity`, no
-- `AlignOrientation`, no assembly the engine will try to simulate — because the moment
-- Roblox's solver has an opinion about where a truck is, there are two writers of its
-- position and we are back in the bug class that cost the last project its movement code.
-- (LESSONS.md C-01.)

local StyleConfig = require(script.Parent.Parent.Config.StyleConfig)
local VehicleConfig = require(script.Parent.Parent.Config.VehicleConfig)

local TruckBuilder = {}

local S = StyleConfig.Truck

local function makePart(name: string, size: Vector3, color: Color3, parent: Instance)
	local part = Instance.new("Part")
	part.Name = name
	part.Size = size
	part.Color = color
	part.Material = Enum.Material.SmoothPlastic
	part.Anchored = true
	part.CanCollide = false
	part.CanTouch = false
	part.CanQuery = false
	part.CastShadow = false
	part.TopSurface = Enum.SurfaceType.Smooth
	part.BottomSurface = Enum.SurfaceType.Smooth
	part.Parent = parent
	return part
end

-- `slot` is the grid position (1..8) and picks the body colour.
function TruckBuilder.build(name: string, slot: number, parent: Instance?)
	local model = Instance.new("Model")
	model.Name = name

	local color = StyleConfig.TruckColors[((slot - 1) % #StyleConfig.TruckColors) + 1]

	local body = makePart("Body", S.bodySize, color, model)
	model.PrimaryPart = body

	makePart("Cab", S.cabSize, color:Lerp(Color3.new(0, 0, 0), 0.18), model)
	makePart("Glass", Vector3.new(S.cabSize.X * 0.8, S.cabSize.Y * 0.5, 0.3), S.glassColor, model)
	makePart("RollBar", S.rollBarSize, Color3.fromRGB(226, 226, 232), model)

	for i = 1, 4 do
		makePart("Wheel" .. i, S.wheelSize, S.wheelColor, model)
	end

	-- Local offsets are precomputed once and cached on the model. `apply` runs at 60 Hz for
	-- eight trucks, and rebuilding eight CFrames per truck per frame from config lookups is
	-- exactly the per-frame attribute reading that LESSONS.md E-02 is about.
	local offsets = {
		Body = CFrame.new(0, 0, 0),
		Cab = CFrame.new(S.cabOffset),
		Glass = CFrame.new(S.cabOffset + Vector3.new(0, 0, -S.cabSize.Z * 0.5)),
		RollBar = CFrame.new(S.rollBarOffset),
	}
	local w = 1
	for _, sx in { -1, 1 } do
		for _, sz in { -1, 1 } do
			offsets["Wheel" .. w] = CFrame.new(sx * S.wheelInset, -S.wheelDrop, sz * S.wheelForward)
			w += 1
		end
	end

	model:SetAttribute("Slot", slot)
	TruckBuilder._offsets[model] = offsets

	model.Parent = parent
	return model
end

TruckBuilder._offsets = setmetatable({}, { __mode = "k" })

-- Copies simulation state onto the model. Called once per rendered frame per truck.
--
-- `groundY` is passed in rather than looked up here, because the caller is already iterating
-- the field and can batch the query — and because a view module should not be reaching into
-- the track to ask questions it can be told the answer to.
function TruckBuilder.apply(model: Model, vehicle, groundY: number)
	local offsets = TruckBuilder._offsets[model]
	local body = model.PrimaryPart
	if not offsets or not body then
		return
	end

	-- The chassis squats onto the wheels under load. Purely cosmetic, and driven by a value
	-- the simulation computed, so a replay reproduces the squash exactly.
	local squat = -vehicle.susp * S.suspensionTravel

	local root = CFrame.new(
		vehicle.px,
		groundY + vehicle.height + VehicleConfig.RestHeight + S.bodySize.Y * 0.5 + squat,
		vehicle.pz
	) * CFrame.Angles(0, vehicle.heading, 0)

	for _, part in model:GetChildren() do
		local offset = offsets[part.Name]
		if offset then
			-- Wheels do not squat with the chassis: they stay on the ground, which is what
			-- sells the suspension travel.
			if part.Name:sub(1, 5) == "Wheel" then
				part.CFrame = root * CFrame.new(0, -squat, 0) * offset
			else
				part.CFrame = root * offset
			end
		end
	end
end

function TruckBuilder.destroy(model: Model)
	TruckBuilder._offsets[model] = nil
	model:Destroy()
end

return TruckBuilder
