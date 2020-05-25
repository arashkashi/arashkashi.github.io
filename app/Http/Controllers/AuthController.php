<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Firebase\JWT\JWT;
use Firebase\JWT\ExpiredException;
use App\User;

class AuthController extends Controller
{
    /**
     * Create a new controller instance.
     *
     * @return void
     */
    public function __construct()
    {
        //
    }

    protected function jwt(User $user) {
        $payload = [
            'iss' => 'nesha-jwt',
            'sub' => $user->id,
            'iat' => time(),
            'exp' => time() + 60*60
        ];

        return jwt::encode($payload, env('JWT_SECRET'));
    }
 
    public function register(Request $request)
    {
        $this->validate($request, [
            'name' => 'required|string',
            'email' => 'required|email|unique:users',
            'password' => 'required|confirmed'
        ]);

        try {
            $user = new User;
            $user->name = $request->input('name');
            $user->email = $request->input('email');
            $plainPass = $request->input('password');
            $user->password = app('hash')->make($plainPass);

            $user->save();

            return response()->json(['user' => $user, 'message' => 'CREATED'], 201);
        } catch (\Exception $e) {

            return response()->json(['message' => 'User Registration Failed'], 409);
        }
    }

    public function login(Request $request)
    {
          //validate incoming request 
        $this->validate($request, [
            'email' => 'required|string',
            'password' => 'required|string',
        ]);

        $user = User::where('email', $request->input('email'))->first();

        if (!$user) {
            return response()->json([
                'error' => 'Email does not exist',
            ], 400);
        }

        if (Hash::check($request->input('password'), $user->password)) {
            return response()->json([
                'api_token' => $this->jwt($user, 200),
                'user' => $user
            ]);
        }

        return response()->json(['error' => 'Email or password is wrong'], 400);
    }
}
