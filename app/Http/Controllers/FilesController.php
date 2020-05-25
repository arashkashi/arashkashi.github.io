<?php namespace App\Http\Controllers;

use Laravel\Lumen\Routing\Controller as BaseController;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\File;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\File\UploadedFile;
use Illuminate\Support\Str;
use Illuminate\Contracts\Routing\UrlRoutable\UrlGenerator;
use App\Helpers;
use App\Filedoc;



class FilesController extends BaseController {

    private function getPath($isPublic) {
        if ($isPublic && $isPublic == true) {

            return storage_path("../public/storage/images");
        } else {
            return storage_path("app/images");
        }
    }

    public function saveFile(Request $request) {

        if (!$request->foreignId || !$request->userId) {
            return response()->json([
                'message' => 'missing foreign key request'
            ], 422);
        }

        if ($request->hasFile('image')) {

            $filename   = $request->filename;
            $ext        = $request->extension;
            $isPublic   = $request->isPublic;
            $foreignId  = $request->foreignId;
            $userId     = $request->userId;

            $destinationPath  = $this->getPath($isPublic);

            $newFileIdName = Str::uuid()->toString();

            $request->file('image')->move($destinationPath, $newFileIdName . "." . $ext);

            $mime_type = $request->file('image')->getClientMimeType();

            $newFile = new Filedoc;
            $newFile->foreign_id    = $foreignId;
            $newFile->user_id       = $userId;
            $newFile->filename      = $newFileIdName;
            $newFile->extension     = $ext;
            $newFile->mimeType      = $mime_type;
            $newFile->isPublic      = $isPublic == "true" ? true : false;

            $newFile->save();

            return response()->json([
                                'message'       => 'success',
                                'extenstion'    => $ext,
                                'filename'      => $newFileIdName,
                                'mimetype'      => $mime_type,
                                'isPublic'      => $isPublic,
                                'foreign_key'   => $request->foreign_key,
                                'user_id'       => $request->user_id
                            ], 200);
        } else {
            return response()->json(['message' => 'fail, no file is attached'], 402);
        }
    }

    public function deleteFile($name) {
        Storage::delete($name);
        return response()->json(['message' => 'success'], 200);
    }

    // public function getFileList(){
    //     $files = Storage::files(‘/’);
    //     return response()->json($files);
    // }
    
    public function viewMediaFile($name){
        $path = storage_path().DIRECTORY_SEPARATOR.’app’.DIRECTORY_SEPARATOR.$name;
        return response()->make(file_get_contents($path), 200, [
            'Content-Type' => Storage::mimeType($name),
            'Content-Disposition' => 'inline; '.$name,
        ]);
    }
}