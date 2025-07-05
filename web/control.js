let video = document.querySelector(".video");
const canvas = document.getElementById("canv");
const ctx = canvas.getContext("2d");
let slider = document.getElementById('slider');

let video_size = {'w': 0, 'h': 0};
let filename = 'in.mp4';
let time_start = 0;
let time_end = 1;
let crop = [null, null];
let selected_file = null;

$(() => {
	console.log('Loaded DOM.');

	$("#video_selector").change(function (e) {
		let fileInput = e.target;
		let fileUrl = window.URL.createObjectURL(fileInput.files[0]);
		filename = fileInput.files[0].name;
		selected_file = fileInput.files[0];
		$(".video").attr("src", fileUrl);
		e.target.remove();
	});

	$("#mute_toggle").click(function (){
		$(video).prop('muted', !$(video).prop('muted'));
	});

	$(".video").bind("loadedmetadata", function (e) {
		video_size = {'w': this.videoWidth, 'h': this.videoHeight};

		// Calculate and apply new dimensions for #resizable
		const videoWidth = this.videoWidth;
		const videoHeight = this.videoHeight;
		const maxWidth = 900; // Max width for the container
		const maxHeight = 500; // Max height for the container

		let newWidth = videoWidth;
		let newHeight = videoHeight;

		// Fit to maxWidth
		if (newWidth > maxWidth) {
			newWidth = maxWidth;
			newHeight = (videoHeight / videoWidth) * newWidth;
		}

		// Fit to maxHeight if necessary, potentially adjusting width again
		if (newHeight > maxHeight) {
			newHeight = maxHeight;
			newWidth = (videoWidth / videoHeight) * newHeight;
		}

		// One final check for width if height adjustment pushed it over
		if (newWidth > maxWidth) {
			newWidth = maxWidth;
			newHeight = (videoHeight / videoWidth) * newWidth;
		}

		$('#resizable').css({
			'width': newWidth + 'px',
			'height': newHeight + 'px'
		});

		// Ensure canvas is also resized after #resizable is set.
		// The update() function already handles canvas resizing based on video element,
		// and video element is 100% of #resizable. This should be fine.

		$('.hide_until_load').removeClass('hidden');
		noUiSlider.create(slider, {
			start: [0, this.duration],
			connect: true,
			range: {
				'min': 0,
				'max': this.duration
			}
		});
		slider.noUiSlider.on('update', (range)=>{
			update_slider_fields(range);
		});
		update_slider_fields();
	}).bind('loadeddata', function(e) {
		// noinspection JSIgnoredPromiseFromCall
		e.target.play();  // start playing
	}).on('pause', (e)=>{
		console.log('Paused: ', e.target.currentTime)
	});

	$('.slider_control').on('change', (e)=>{
		set_slider();
	});

	let drawing = false;
	$("#canv").mousedown((e)=>{
		let pos = getMousePos(canvas, e);
		drawing = true;
		console.log('click', pos);
		crop = [pos, null]
	}).mousemove(function(e) {
		if(!drawing)
			return;
		let pos = getMousePos(canvas, e);
		crop = [crop[0], pos];
	}).on('mouseup', function(e) {
		if(!drawing)
			return;
		let pos = getMousePos(canvas, e);
		console.log('Mouse Up', pos);
		crop = [crop[0], pos];
		drawing = false;
		if(crop[0].x === crop[1].x && crop[0].y === crop[1].y)
			crop = [null, null];
		console.log(crop);
	});

	$('.slider_time_pos').on('mousedown', function(e) {
		document.onselectstart = function() {return false};
		let parentrect = e.target.parentElement.getBoundingClientRect();
		function mup(){
			document.onmousemove = null;
			document.onmouseup = null;
			document.onselectstart = function() {return true};
		}
		function mmov(e){
			let percent = (e.clientX-parentrect.x) / (parentrect.width);
			// prevents the time_pos from resetting to 0 after sliding off past 100%
			let total_percent = percent > 1 ? .999999 : percent;
			video.currentTime = video.duration * total_percent
		}
		document.onmousemove = function(e) {mmov(e)};
		document.onmouseup = function() {mup()};
	});
});

$("#run_ffmpeg").click(async () => {
	try{
		const heap_limit = performance.memory.jsHeapSizeLimit;
		if(heap_limit){
			if(selected_file.size * 2.5 > (heap_limit - performance.memory.usedJSHeapSize)){
				if(!confirm("The given file is so large, it is likely to crash your browser!\n\nContinue?")){
					return
				}
			}
		}
	}catch{}

	const cmd = build_ffmpeg_string(true);
	const { createFFmpeg, fetchFile } = FFmpeg;
	const message = document.querySelector(".ffmpeg_log");
	const ffmpeg = createFFmpeg({
		log: true,
		progress: ({ ratio }) => {
			message.innerHTML = `Transcoding Video: ${(ratio * 100.0).toFixed(2)}%`;
			document.title = message.innerHTML;
		},
	});

	try {
		document.querySelector(".download_links").innerHTML = '';
		const {name} = selected_file;
		message.innerHTML = 'Loading ffmpeg-core.js';
		await ffmpeg.load();
		message.innerHTML = 'Start transcoding';
		ffmpeg.FS('writeFile', name, await fetchFile(selected_file));
		await ffmpeg.run(...cmd);// '-i', name,  'output.mp4');
		message.innerHTML = 'Complete transcoding';
		document.title = message.innerHTML;
		const data = ffmpeg.FS('readFile', 'output.mp4');

		let a = document.createElement('a');
		let fn = decodeURI(name);
		a.download = fn;
		let blob = new Blob([data.buffer], {type: 'video/mp4'});
		a.href = window.URL.createObjectURL(blob);
		a.textContent = 'Click here to download [' + fn + "]!";

		document.querySelector(".download_links").append(a);
		a.click();
	} catch (err) {
		console.error(err);
		message.innerHTML = 'Error processing input file. It may be too large for the browser to manage.';
	}
});


function update_slider_fields(range){
	if(!range || range.length < 2)
		return;
	document.querySelectorAll('.slider_control').forEach(function(input) {
		// noinspection JSUndefinedPropertyAssignment
		input.value = range[input.dataset.pos];
	});
	time_start = parseFloat(range[0]);
	time_end = parseFloat(range[1]);
}

function set_slider(){
	let vals = [];
	document.querySelectorAll('.slider_control').forEach(function(input) {
		vals.push(input.value)
	});
	console.log(vals);
	slider.noUiSlider.set(vals);
}


function getMousePos(canvas, evt) {
	let rect = canvas.getBoundingClientRect();
	return {
		x: (evt.clientX - rect.left) / rect.width,
		y: (evt.clientY - rect.top) / rect.height
	};
}

function unscale(coords, rect){
	return{
		'x': coords.x * rect.width,
		'y': coords.y * rect.height
	}
}

function crop_box(crop, in_width, in_height){
	let rect = {'width': in_width, 'height': in_height};
	let p1 = unscale(crop[0], rect), p2 = unscale(crop[1],rect);
	let x = Math.min(p1.x, p2.x);
	let y = Math.min(p1.y, p2.y);
	let w = Math.abs(p1.x - p2.x);
	let h = Math.abs(p1.y - p2.y);
	return {
		'x': Math.floor(x),
		'y': Math.floor(y),
		'w': Math.floor(w),
		'h': Math.floor(h)
	}
}

function pause_toggle(){
	console.log('toggle play');
	if(video.paused){
		video.play().finally(()=>{$(".play_toggle").html('&#10074;&#10074;')});
	}else{
		video.pause();
		$(".play_toggle").html('&#9654;')
	}
}

async function copyText() {
	await navigator.permissions.query({name: "clipboard-write"});

	await navigator.clipboard.writeText($('.ffmpeg').text()).then(() => {
		console.log('Copied to clipboard.');
	}).catch(console.error)
}

function build_ffmpeg_string(for_browser_run=false){
	let ts = (time_start?time_start.toFixed(2):0);
	let te = (time_end?time_end.toFixed(2):0);
	let args = [
		'-i', `${for_browser_run ? filename : '"' + filename + '"'}`,
		'-movflags', 'faststart',
		'-t', (te-ts).toFixed(4)
	];
	if (ts) {
		args.unshift('-ss', ts);
	}
	if(crop[0] && crop[1]){
		let box = crop_box(crop, video_size.w, video_size.h);
		let crp = `"crop=${box.w}:${box.h}:${box.x}:${box.y}"`;
		if (for_browser_run) crp = crp.replace(/"/g, '');
		args.push('-filter:v', crp);
	}
	let fn = for_browser_run ? 'output.mp4' : `"edit - ${filename}"`;
	args.push('-c:a', 'copy');
	args.push(fn);
	return for_browser_run ? args : args.join(' ');
}

function update(){
	canvas.width = $(video).width();
	canvas.height = $(video).height();
	ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
	if (video.currentTime < time_start)
		video.currentTime = time_start;
	if (video.currentTime > time_end)
		video.currentTime = time_start;
	let complete_percent = 100 * (video.currentTime / video.duration);
	$(".slider_time_pos").css("left", complete_percent + "%");
	$(".current_time").text(video.currentTime.toFixed(2));
	// noinspection JSCheckFunctionSignatures
	ctx.drawImage(video, 0, 0, canvas.width, canvas.height); //TODO: Subimage using crop.

	if(crop[0] && crop[1]){
		let rect = canvas.getBoundingClientRect();
		let box = crop_box(crop, rect.width, rect.height);
		ctx.strokeStyle="#FF0000";
		ctx.strokeRect(box.x, box.y, box.w, box.h);
	}

	let mpeg = 'ffmpeg ' + build_ffmpeg_string(false);
	if($('.ffmpeg').text() !== mpeg) {
		$('.ffmpeg').text(mpeg);
	}
	requestAnimationFrame(update.bind(this)); // Tell browser to trigger this method again, next animation frame.
}

update(); //Start rendering
