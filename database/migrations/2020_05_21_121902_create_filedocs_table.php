<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class CreateFiledocsTable extends Migration
{
    /**
     * Run the migrations.
     *
     * @return void
     */
    public function up()
    {
        Schema::create('filedocs', function (Blueprint $table) {
            $table->string('id', 50)->primary('id');
            $table->string('foreign_id');
            $table->string('user_id');
            $table->string('filename');
            $table->string('extension');
            $table->string('mimeType');
            $table->boolean('isPublic');
            $table->json('properties')->nullable();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     *
     * @return void
     */
    public function down()
    {
        Schema::dropIfExists('files');
    }
}
